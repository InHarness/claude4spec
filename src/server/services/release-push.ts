/**
 * M25 Release Push — service-owner of the `release_push` table and the push flow.
 *
 * `push(releaseId)` is a COORDINATOR: it gates on the M24 session, delegates the
 * bundle build to M17 (`releaseService.buildBundleArchive`), transports it via the
 * M24 client (`remoteAuth.pushBundle`), records the attempt, and cleans up. It
 * never builds the bundle itself — there are intentionally NO `tar`/`gzip`/
 * `archiver`/`crypto.createHash` imports here (grep-checkable, AC m25).
 *
 * Every completed attempt (success OR error) is an append-only INSERT; in-progress
 * attempts are not persisted. Retry = a new INSERT (no UPDATE, no DELETE).
 *
 * Spec: brief 0-1-28-to-0-1-29.md (M25).
 */

import type Database from 'better-sqlite3';
import { unlink } from 'node:fs/promises';
import { DomainError } from './tags.js';
import { readConfig, writeConfig } from '../config.js';
import { RemoteUnauthorizedError, RemoteRequestError } from './remote-http-client.js';
import type { ReleaseService } from './release.js';
import type { RemoteAuthService, PushBundleOutcome } from './remote-auth.js';
import type { ReleasePushResponse } from '../../shared/release-push.js';

interface ReleasePushRow {
  id: number;
  release_id: number;
  remote_project_id: string | null;
  remote_release_id: string | null;
  remote_release_sequence: number | null;
  content_sha256: string;
  content_size_bytes: number;
  deduplicated: number;
  pushed_by_account_id: string;
  pushed_by_account_email: string | null;
  bundle_schema_version: number;
  status: string;
  error_message: string | null;
  pushed_at: string;
  release_name: string; // from the JOIN
}

/** Shared projection — the row plus the local release name (saves the UI a fetch). */
const SELECT_WITH_RELEASE =
  `SELECT rp.*, sr.name AS release_name
     FROM release_push rp
     JOIN spec_release sr ON sr.id = rp.release_id`;

interface InsertArgs {
  releaseId: number;
  /**
   * UUID from the peer. `null` on first-push error rows (the peer never returned
   * an id). Subsequent-push errors persist the known `config.remoteProjectId`.
   */
  remoteProjectId: string | null;
  remoteReleaseId: string | null;
  remoteReleaseSequence: number | null;
  contentSha256: string;
  contentSizeBytes: number;
  deduplicated: boolean;
  accountId: string;
  accountEmail: string | null;
  bundleSchemaVersion: number;
  status: 'success' | 'error';
  errorMessage: string | null;
}

export class ReleasePushService {
  constructor(
    private db: Database.Database,
    private releaseService: ReleaseService,
    private remoteAuth: RemoteAuthService,
    private cwd: string,
  ) {}

  /**
   * Synchronous push of release N to the remote. Algorithm (brief §1.3):
   * gate → validate release → build bundle (M17) → transport (M24) → persist →
   * cleanup. The bundle's `tarGzPath` is unlinked in `finally` ALWAYS (M17 does
   * not clean it up — the consumer owns it).
   */
  async push(releaseId: number): Promise<ReleasePushResponse> {
    // 1. Gate (M24). Snapshot identity here so it survives a 401 mid-push (which
    //    wipes remote_session) — the audit row still records who attempted it.
    const account = this.remoteAuth.getCurrentAccount();
    if (!account.connected) {
      throw new DomainError('NOT_CONNECTED', 'Connect to the remote server before pushing');
    }
    if (account.accountStatus !== 'active') {
      throw new DomainError('ACCOUNT_NOT_ACTIVE', 'Account deactivated — push is blocked');
    }
    const accountId = account.remoteAccountId ?? '';
    const accountEmail = account.accountEmail ?? null;

    // 2. Validate the local release exists (frozen releases are allowed).
    try {
      this.releaseService.getRelease(releaseId);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'NOT_FOUND') {
        throw new DomainError('RELEASE_NOT_FOUND', `release '${releaseId}' not found`);
      }
      throw err;
    }

    // 3. Build the bundle (M17). All bytes-derived values come from here.
    const bundle = await this.releaseService.buildBundleArchive(releaseId);
    const config = readConfig(this.cwd);
    const firstPush = config.remoteProjectId == null;

    try {
      let outcome: PushBundleOutcome;
      try {
        // 4. Transport (M24 injects the Bearer; handles 401 → session wipe).
        outcome = await this.remoteAuth.pushBundle({
          tarGzPath: bundle.tarGzPath,
          sizeBytes: bundle.sizeBytes,
          sha256: bundle.sha256,
          projectName: config.name,
          remoteProjectId: config.remoteProjectId ?? null,
        });
      } catch (err) {
        // 5a. Error attempt → append an error row, then re-throw mapped to 502.
        const sessionExpired = err instanceof RemoteUnauthorizedError;
        const errorMessage = sessionExpired
          ? 'Session expired'
          : err instanceof RemoteRequestError
            ? err.message
            : 'Network error';
        this.insertRow({
          releaseId,
          // First-push error → null (column is nullable since migration 032).
          // Subsequent-push error → persist the known config.remoteProjectId.
          remoteProjectId: config.remoteProjectId ?? null,
          remoteReleaseId: null,
          remoteReleaseSequence: null,
          contentSha256: bundle.sha256,
          contentSizeBytes: bundle.sizeBytes,
          deduplicated: false,
          accountId,
          accountEmail,
          bundleSchemaVersion: bundle.bundleSchemaVersion,
          status: 'error',
          errorMessage,
        });
        throw new DomainError(
          sessionExpired ? 'SESSION_EXPIRED' : 'PUSH_FAILED',
          sessionExpired ? 'Session expired, log in and try again' : errorMessage,
        );
      }

      // 5b. Success. On first push, persist the new remoteProjectId atomically
      //     so subsequent pushes go to POST /v1/projects/:id/releases.
      if (firstPush) {
        writeConfig(this.cwd, { remoteProjectId: outcome.remoteProjectId });
      }
      const id = this.insertRow({
        releaseId,
        remoteProjectId: outcome.remoteProjectId,
        remoteReleaseId: outcome.remoteReleaseId,
        remoteReleaseSequence: outcome.remoteReleaseSequence,
        contentSha256: bundle.sha256,
        contentSizeBytes: bundle.sizeBytes,
        deduplicated: outcome.deduplicated,
        accountId,
        accountEmail,
        bundleSchemaVersion: bundle.bundleSchemaVersion,
        status: 'success',
        errorMessage: null,
      });
      return this.getById(id)!;
    } finally {
      // 6. ALWAYS clean up the bundle the consumer owns.
      await unlink(bundle.tarGzPath).catch(() => {});
    }
  }

  /** Audit log for one release, newest first (uses idx_release_push_release_id). */
  listForRelease(releaseId: number): ReleasePushResponse[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_RELEASE} WHERE rp.release_id = ? ORDER BY rp.pushed_at DESC, rp.id DESC`)
      .all(releaseId) as ReleasePushRow[];
    return rows.map(toDto);
  }

  getById(id: number): ReleasePushResponse | null {
    const row = this.db
      .prepare(`${SELECT_WITH_RELEASE} WHERE rp.id = ?`)
      .get(id) as ReleasePushRow | undefined;
    return row ? toDto(row) : null;
  }

  /**
   * Whole audit log, newest first. Consumed by the `/releases` page to derive
   * per-release push-count badges — one request per render, aggregated
   * client-side, rather than N × `?releaseId=X`. (M17 owns release identity,
   * M25 owns the push audit log — see brief 0.1.32 §3.)
   */
  listAll(): ReleasePushResponse[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_RELEASE} ORDER BY rp.pushed_at DESC, rp.id DESC`)
      .all() as ReleasePushRow[];
    return rows.map(toDto);
  }

  private insertRow(a: InsertArgs): number {
    const info = this.db
      .prepare(
        `INSERT INTO release_push
           (release_id, remote_project_id, remote_release_id, remote_release_sequence,
            content_sha256, content_size_bytes, deduplicated,
            pushed_by_account_id, pushed_by_account_email, bundle_schema_version,
            status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.releaseId,
        a.remoteProjectId,
        a.remoteReleaseId,
        a.remoteReleaseSequence,
        a.contentSha256,
        a.contentSizeBytes,
        a.deduplicated ? 1 : 0,
        a.accountId,
        a.accountEmail,
        a.bundleSchemaVersion,
        a.status,
        a.errorMessage,
      );
    return Number(info.lastInsertRowid);
  }
}

function toDto(row: ReleasePushRow): ReleasePushResponse {
  return {
    id: row.id,
    releaseId: row.release_id,
    release: { id: row.release_id, name: row.release_name },
    remoteProjectId: row.remote_project_id ?? undefined,
    remoteReleaseId: row.remote_release_id ?? undefined,
    remoteReleaseSequence: row.remote_release_sequence ?? undefined,
    contentSha256: row.content_sha256,
    contentSizeBytes: row.content_size_bytes,
    deduplicated: row.deduplicated === 1,
    pushedByAccountId: row.pushed_by_account_id,
    pushedByAccountEmail: row.pushed_by_account_email ?? undefined,
    bundleSchemaVersion: row.bundle_schema_version,
    status: row.status === 'error' ? 'error' : 'success',
    errorMessage: row.error_message ?? undefined,
    pushedAt: row.pushed_at,
  };
}
