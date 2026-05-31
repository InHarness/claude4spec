/**
 * M27 Project Clone — service-owner of the `release_import` table and the clone
 * flow. `clone(slug)` is a COORDINATOR (reverse peer of M25 `ReleasePushService`):
 * it resolves the remote project anonymously, downloads the latest published
 * release bundle, verifies its hash, restores it via M17
 * (`releaseService.restoreBundleArchive`), collects the restored rows into local
 * release #1 (`releaseService.createRelease`), persists `remoteProjectId` so a
 * later push targets the same remote project, and records the attempt.
 *
 * No auth gate — the published snapshot is served anonymously, so clone has zero
 * dependency on the M24 device-flow / session machinery. Only a SUCCESSFUL clone
 * writes an append-only `release_import` row (`status='success'`). A failed clone
 * throws and writes nothing: the bootstrap caller performs a full all-or-nothing
 * rollback of `cwd` (see {@link rollbackClone}) that deletes `db.sqlite`, so there
 * is nowhere for an error row to survive — failures surface only via stderr + a
 * non-zero exit.
 *
 * Spec: brief 0-1-36-to-0-1-37.md (§ full-rollback clone).
 */

import fs, { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { DomainError } from './tags.js';
import { readConfig, writeConfig, type Config } from '../config.js';
import {
  RemoteRequestError,
  type RemoteHttpClient,
  type ProjectMetaResponse,
  type SnapshotDownloadResult,
} from './remote-http-client.js';
import type { ReleaseService } from './release.js';
import { readBundleMeta, sha256File } from './release-bundle.js';
import type { ReleaseImportResponse } from '../../shared/release-import.js';

interface ReleaseImportRow {
  id: number;
  local_release_id: number | null;
  remote_project_id: string | null;
  remote_project_slug: string;
  remote_release_id: string | null;
  remote_release_sequence: number | null;
  content_sha256: string | null;
  content_size_bytes: number | null;
  bundle_schema_version: number | null;
  imported_by_account_id: string | null;
  imported_by_account_email: string | null;
  status: string;
  error_message: string | null;
  imported_at: string;
  local_release_name: string | null; // from the LEFT JOIN
}

interface InsertArgs {
  localReleaseId: number | null;
  remoteProjectId: string | null;
  remoteProjectSlug: string;
  remoteReleaseId: string | null;
  remoteReleaseSequence: number | null;
  contentSha256: string | null;
  contentSizeBytes: number | null;
  bundleSchemaVersion: number | null;
  status: 'success' | 'error';
  errorMessage: string | null;
}

/** Shared projection — the row plus the local release name (LEFT JOIN: nullable). */
const SELECT_WITH_RELEASE =
  `SELECT ri.*, sr.name AS local_release_name
     FROM release_import ri
     LEFT JOIN spec_release sr ON sr.id = ri.local_release_id`;

export class ReleaseImportService {
  constructor(
    private db: Database.Database,
    private releaseService: ReleaseService,
    private remote: RemoteHttpClient,
    private cwd: string,
  ) {}

  /**
   * Clone the latest published release of remote project `slug` into the local
   * (empty) project. On any caught failure: throw (no audit row) — the bootstrap
   * caller catches it, performs a full rollback ({@link rollbackClone}) so `cwd`
   * returns to its pre-`--clone` state, and exits non-zero.
   */
  async clone(slug: string, opts: { nameOverride?: string } = {}): Promise<ReleaseImportResponse> {
    // 1. Defensive empty-target check (the authoritative guard runs in the bin
    //    before openDb; here we guard against a non-fresh DB).
    this.assertTargetEmpty();

    let tarGzPath: string | null = null;
    let localReleaseId: number | null = null;
    let download: SnapshotDownloadResult | null = null;
    let bundleSchemaVersion: number | null = null;
    try {
      // 2. Resolve project (404 / non-published ⇒ REMOTE_PROJECT_NOT_FOUND).
      let project: ProjectMetaResponse;
      try {
        project = await this.remote.getProjectBySlug(slug);
      } catch (err) {
        throw mapRemoteError(err, slug);
      }
      if (project.status !== 'published') {
        throw new DomainError('REMOTE_PROJECT_NOT_FOUND', `remote project '${slug}' is not published`);
      }

      // 3. Download the latest-release bundle to a temp file.
      tarGzPath = path.join(os.tmpdir(), `c4s-clone-${nanoid()}.tar.gz`);
      try {
        download = await this.remote.downloadSnapshot(slug, tarGzPath);
      } catch (err) {
        throw mapRemoteError(err, slug);
      }

      // 4. Verify SHA-256 of the streamed bytes against the header.
      if (download.contentSha256) {
        const actual = await sha256File(tarGzPath);
        if (actual !== download.contentSha256.toLowerCase()) {
          throw new DomainError(
            'BUNDLE_HASH_MISMATCH',
            `bundle SHA-256 mismatch (expected ${download.contentSha256}, got ${actual})`,
          );
        }
      }

      // 4b. Read the manifest + bundled config (schema version for the audit row;
      //     name/entities for the post-restore config patch).
      const { manifest, config: bundleConfig } = await readBundleMeta(tarGzPath);
      bundleSchemaVersion = manifest.bundleSchemaVersion;

      // 5. Restore (M17) — UPSERTs entities + pages with release_id = NULL.
      await this.releaseService.restoreBundleArchive(createReadStream(tarGzPath));

      // 6. Create local release #1 (no assignUnreleased — createRelease
      //    auto-collects every release_id IS NULL row).
      const seqLabel = download.releaseSequence ?? '?';
      const remoteReleaseLabel = download.releaseId ?? String(manifest.release.id);
      const release = this.releaseService.createRelease(
        {
          name: `imported-from-${slug}@r${seqLabel}`,
          description: `Initial clone of remote project ${slug} release ${remoteReleaseLabel}`,
        },
        'user',
      );
      localReleaseId = release.id;

      // 7 + 8. Persist remoteProjectId (subsequent-push target) + name (CLI
      //         override wins, else bundle config.name) + skip onboarding.
      const projectId = download.projectId ?? project.id;
      const patch: Partial<Config> = {
        remoteProjectId: projectId,
        name: opts.nameOverride ?? bundleConfig?.name ?? project.name,
        onboardingCompleted: true,
      };
      if (bundleConfig?.entities !== undefined) patch.entities = bundleConfig.entities;
      writeConfig(this.cwd, patch);

      // 9. Audit success.
      const id = this.insertRow({
        localReleaseId,
        remoteProjectId: projectId,
        remoteProjectSlug: slug,
        remoteReleaseId: download.releaseId,
        remoteReleaseSequence: download.releaseSequence,
        contentSha256: download.contentSha256,
        contentSizeBytes: download.contentLength,
        bundleSchemaVersion,
        status: 'success',
        errorMessage: null,
      });
      return this.get(id)!;
    } catch (err) {
      // No audit row on failure (brief 0.1.37): the bootstrap caller performs a
      // full rollback that deletes db.sqlite, so there is nowhere for an error row
      // to live. Failures surface only via stderr + a non-zero exit. (A future
      // post-bootstrap import — DB exists before the import, rollback does not wipe
      // it — will reintroduce status='error', because there it has somewhere to live.)
      if (err instanceof DomainError) throw err;
      throw new DomainError('CLONE_FAILED', err instanceof Error ? err.message : String(err));
    } finally {
      // 10. Always remove the temp tarball.
      if (tarGzPath) await unlink(tarGzPath).catch(() => {});
    }
  }

  /** Whole import audit log, newest first. Forward-looking (no HTTP surface in v1). */
  listAll(): ReleaseImportResponse[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_RELEASE} ORDER BY ri.imported_at DESC, ri.id DESC`)
      .all() as ReleaseImportRow[];
    return rows.map(toDto);
  }

  /** Single import row by id, or null. */
  get(id: number): ReleaseImportResponse | null {
    const row = this.db
      .prepare(`${SELECT_WITH_RELEASE} WHERE ri.id = ?`)
      .get(id) as ReleaseImportRow | undefined;
    return row ? toDto(row) : null;
  }

  private assertTargetEmpty(): void {
    const c = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM spec_release)  AS releases,
           (SELECT COUNT(*) FROM entity_version) AS entities,
           (SELECT COUNT(*) FROM page_version)   AS pages`,
      )
      .get() as { releases: number; entities: number; pages: number };
    if (c.releases > 0 || c.entities > 0 || c.pages > 0) {
      throw new DomainError('CLONE_TARGET_NOT_EMPTY', 'target project already contains spec data');
    }
    // Belt-and-suspenders: a stale remoteProjectId would mis-target a later push.
    if (readConfig(this.cwd).remoteProjectId != null) {
      throw new DomainError('CLONE_TARGET_NOT_EMPTY', 'target project is already linked to a remote project');
    }
  }

  private insertRow(a: InsertArgs): number {
    const info = this.db
      .prepare(
        `INSERT INTO release_import
           (local_release_id, remote_project_id, remote_project_slug, remote_release_id,
            remote_release_sequence, content_sha256, content_size_bytes, bundle_schema_version,
            imported_by_account_id, imported_by_account_email, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.localReleaseId,
        a.remoteProjectId,
        a.remoteProjectSlug,
        a.remoteReleaseId,
        a.remoteReleaseSequence,
        a.contentSha256,
        a.contentSizeBytes,
        a.bundleSchemaVersion,
        null, // imported_by_account_id — NULL for anon v1 clone
        null, // imported_by_account_email — NULL for anon v1 clone
        a.status,
        a.errorMessage,
      );
    return Number(info.lastInsertRowid);
  }
}

/**
 * Full all-or-nothing rollback of a failed `--clone` (brief 0.1.37). Removes
 * exactly what THIS bootstrap run created so `cwd` returns to its pre-`--clone`
 * state; pre-existing user files (e.g. a hand-seeded `.claude4spec/config.json`
 * with a `remoteApiUrl` override) are never touched. The caller MUST close the DB
 * handle before invoking this so `db.sqlite` can be unlinked (required on Windows).
 */
export function rollbackClone(
  cwd: string,
  opts: {
    pagesDir: string;
    configCreated: boolean;
    claudeDirCreated: boolean;
    gitignoreCreated: boolean;
  },
): void {
  const rm = (p: string): void => fs.rmSync(p, { recursive: true, force: true });
  const claudeDir = path.join(cwd, '.claude4spec');
  // db.sqlite + WAL sidecars — always run-created (the empty-target guard forbids a
  // pre-existing db.sqlite). Deleted explicitly so the case where .claude4spec/
  // pre-existed (and so is kept below) is still covered.
  for (const f of ['db.sqlite', 'db.sqlite-wal', 'db.sqlite-shm']) rm(path.join(claudeDir, f));
  // pages/ + restored files — ensureBootstrap is skipped for clone, so pages/ is
  // wholly a restore mutation of this run.
  rm(path.join(cwd, opts.pagesDir));
  // Run-created scaffolding only — a pre-existing config.json / .claude4spec/ /
  // .gitignore (we'd have only appended to the last) is left untouched.
  if (opts.configCreated) rm(path.join(claudeDir, 'config.json')); // M01 step 5
  if (opts.gitignoreCreated) rm(path.join(cwd, '.gitignore')); // M01 ensureGitignore
  if (opts.claudeDirCreated) rm(claudeDir); // M01 step 3
}

/** Map a remote-client failure to a clone DomainError (404 ⇒ not-found). */
function mapRemoteError(err: unknown, slug: string): DomainError {
  if (err instanceof RemoteRequestError && err.status === 404) {
    return new DomainError('REMOTE_PROJECT_NOT_FOUND', `remote project '${slug}' not found`);
  }
  return new DomainError('CLONE_FAILED', err instanceof Error ? err.message : 'remote request failed');
}

function toDto(row: ReleaseImportRow): ReleaseImportResponse {
  return {
    id: row.id,
    localReleaseId: row.local_release_id ?? undefined,
    localRelease:
      row.local_release_id != null && row.local_release_name != null
        ? { id: row.local_release_id, name: row.local_release_name }
        : undefined,
    remoteProjectId: row.remote_project_id ?? undefined,
    remoteProjectSlug: row.remote_project_slug,
    remoteReleaseId: row.remote_release_id ?? undefined,
    remoteReleaseSequence: row.remote_release_sequence ?? undefined,
    contentSha256: row.content_sha256 ?? undefined,
    contentSizeBytes: row.content_size_bytes ?? undefined,
    bundleSchemaVersion: row.bundle_schema_version ?? undefined,
    importedByAccountId: row.imported_by_account_id ?? undefined,
    importedByAccountEmail: row.imported_by_account_email ?? undefined,
    status: row.status === 'error' ? 'error' : 'success',
    errorMessage: row.error_message ?? undefined,
    importedAt: row.imported_at,
  };
}
