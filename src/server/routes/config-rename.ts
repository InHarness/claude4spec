import { Router } from 'express';
import {
  readConfig,
  writeConfig,
  isValidRootId,
  isReservedRootId,
  configHash,
  builtinRoot,
} from '../config.js';
import {
  appendTransition,
  clearRenameJournal,
  readRootRenames,
  relinkRoots,
  resolveCurrentRootId,
  retiredRootIds,
  writeRenameJournal,
} from '../root-renames.js';

/**
 * 0.2.101 — `POST /api/config/roots/:rootId/rename` (M01).
 *
 * ## Why this is not `PATCH /api/config`
 *
 * PATCH replaces the whole `roots[]` array. A changed `id` inside such a body is
 * indistinguishable from "delete one root, create another" — and those two have
 * OPPOSITE consequences for pages and history: a rename keeps the space (its
 * files, its version timeline, everything linking to it), a delete+create drops
 * all of it. The operation therefore gets its own route, which names the source
 * space in the path and carries one intent.
 *
 * It lives under `/api/config` because a root is a configuration entry, not a
 * resource of its own; there is no `/api/roots/...` family and no module mounts
 * one.
 *
 * ## What it does and does not do
 *
 * Changes the ADDRESS only. The directory, the label, the behaviour properties,
 * the files and every section anchor stay exactly as they are; no page file is
 * written, so no `file_version` row is captured either — a capture would have
 * nothing to snapshot. It does not move the directory, does not rewrite past
 * releases or their bundles, and does not install an alias one may write under.
 *
 * The retired identifier is recorded permanently. Asking for it afterwards
 * behaves like asking for any unknown root — never a quiet redirect.
 */

export interface RenameRootRequest {
  newId: string;
  expectedConfigHash: string;
}

export interface RenameRootResponse {
  /** The identifier after the operation — the live address from here on. */
  rootId: string;
  /** The identifier from before it; recorded as a transition and permanently taken. */
  previousRootId: string;
  /** Unchanged — identity and location are independent. */
  dir: string;
  /** Unchanged. */
  name: string;
  /** Unchanged — the base root stays the base root under its new id. */
  builtin: boolean;
  /** Roots whose `linkTargets` pointed at the old id and were relinked in the SAME write. */
  relinkedRoots: string[];
  /** True when this request replays a rename that already completed. */
  alreadyApplied: boolean;
  /** sha256 of the config after the write — the token for the next operation. */
  configHash: string;
}

export type RenameRootErrorCode =
  | 'VALIDATION'
  | 'ROOT_NOT_FOUND'
  | 'ROOT_ID_TAKEN'
  | 'CONFIG_CONFLICT'
  | 'RENAME_IN_PROGRESS';

export interface RenameRootError {
  error: string;
  code: RenameRootErrorCode;
  rootId?: string;
  newId?: string;
}

const STATUS: Record<RenameRootErrorCode, number> = {
  VALIDATION: 400,
  ROOT_NOT_FOUND: 404,
  ROOT_ID_TAKEN: 409,
  CONFIG_CONFLICT: 409,
  RENAME_IN_PROGRESS: 409,
};

export interface RootRenameDeps {
  cwd: string;
  /**
   * Fired after a committed rename. Invalidates the project context, which is
   * the WHOLE of "unmount the old identity, mount the new one, rebuild the
   * indexes": the retired context disposes its `pages:<oldId>` watch mount and
   * the successor is built on the already-switched registry, mounting
   * `pages:<newId>` over the same directory and running the boot `indexAll()`
   * for the section index and the link index.
   *
   * It must run AFTER the commit, never before: a context built halfway through
   * would hold mounts under both addresses at once.
   */
  onRootRenamed?: (oldId: string, newId: string) => void;
}

/**
 * One rename at a time per project. The window is tiny (two small file writes)
 * but it must not overlap: two concurrent renames would race on the config's
 * read-modify-write and could produce a transition chain that no longer matches
 * what is in `roots[]`.
 */
const inProgress = new Set<string>();

export function rootRenameRouter(deps: RootRenameDeps): Router {
  const { cwd } = deps;
  const router = Router({ mergeParams: true });

  router.post('/roots/:rootId/rename', (req, res) => {
    const rootId = String(req.params.rootId ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;

    const fail = (code: RenameRootErrorCode, error: string, extra: Partial<RenameRootError> = {}): void => {
      res.status(STATUS[code]).json({ error, code, ...extra } satisfies RenameRootError);
    };

    if (inProgress.has(cwd)) {
      return fail('RENAME_IN_PROGRESS', 'another root rename is running in this project — retry once it finishes', {
        rootId,
      });
    }

    inProgress.add(cwd);
    try {
      const newId = body.newId;
      const expectedConfigHash = body.expectedConfigHash;
      const config = readConfig(cwd);
      const transitions = readRootRenames(cwd).transitions;

      // Replay FIRST, before the "unknown source root" refusal: after a
      // successful rename the source id is retired, so a client whose response
      // was lost would otherwise be told 404 for an operation that did work.
      if (typeof newId === 'string' && !config.roots.some((r) => r.id === rootId)) {
        const landedOn = resolveCurrentRootId(transitions, rootId);
        if (landedOn !== null && landedOn === newId) {
          const root = config.roots.find((r) => r.id === newId);
          if (root) {
            return void res.json({
              rootId: root.id,
              previousRootId: rootId,
              dir: root.dir,
              name: root.name,
              builtin: root.builtin,
              // The relink happened in the original commit; replay reports the
              // outcome, it does not redo the write.
              relinkedRoots: config.roots.filter((r) => r.linkTargets.includes(newId)).map((r) => r.id),
              alreadyApplied: true,
              configHash: configHash(cwd),
            } satisfies RenameRootResponse);
          }
        }
      }

      const source = config.roots.find((r) => r.id === rootId);
      if (!source) {
        return fail('ROOT_NOT_FOUND', `no root '${rootId}' in this project`, { rootId });
      }

      if (typeof newId !== 'string' || !isValidRootId(newId)) {
        return fail(
          'VALIDATION',
          'newId must be a kebab-case slug — no spaces, slashes or empty value',
          { rootId, newId: typeof newId === 'string' ? newId : undefined },
        );
      }
      // The commit's `writeConfig` only WARNS on a reserved id (its read-path
      // leniency), so the route must refuse it itself — exactly as PATCH does.
      if (isReservedRootId(newId)) {
        return fail(
          'VALIDATION',
          `root id '${newId}' is reserved — it names a route under /api/pages/, so a root using it would be unreachable there`,
          { rootId, newId },
        );
      }
      if (newId === rootId) {
        return fail('VALIDATION', `root '${rootId}' already answers under that identifier — a no-op is not a rename`, {
          rootId,
          newId,
        });
      }
      if (typeof expectedConfigHash !== 'string' || expectedConfigHash === '') {
        return fail('VALIDATION', 'expectedConfigHash is required — read it from GET /api/config', { rootId, newId });
      }

      const taken = config.roots.find((r) => r.id === newId);
      if (taken) {
        return fail('ROOT_ID_TAKEN', `identifier '${newId}' is already used by the root '${taken.name}'`, {
          rootId,
          newId,
        });
      }
      if (retiredRootIds(cwd).has(newId)) {
        return fail(
          'ROOT_ID_TAKEN',
          `identifier '${newId}' was retired by an earlier rename and stays taken — page history written under it names a different space`,
          { rootId, newId },
        );
      }

      if (configHash(cwd) !== expectedConfigHash) {
        return fail('CONFIG_CONFLICT', 'the configuration changed since you read it — re-read it and try again', {
          rootId,
          newId,
        });
      }

      // ---- commit ------------------------------------------------------
      // Journal first: it is what lets the next startup finish or fully undo an
      // operation interrupted between the two writes below.
      writeRenameJournal(cwd, { from: rootId, to: newId, startedAt: new Date().toISOString() });

      const renamed = config.roots.map((r) => (r.id === rootId ? { ...r, id: newId } : r));
      // Every `linkTargets` entry across every root moves in the SAME write —
      // there is no instant at which the config on disk points at an id that no
      // root answers to.
      const { roots, relinked } = relinkRoots(renamed, rootId, newId);
      const updated = writeConfig(cwd, { roots });
      appendTransition(cwd, rootId, newId);
      clearRenameJournal(cwd);

      deps.onRootRenamed?.(rootId, newId);

      const after = updated.roots.find((r) => r.id === newId) ?? builtinRoot(updated.roots);
      return void res.json({
        rootId: newId,
        previousRootId: rootId,
        dir: after.dir,
        name: after.name,
        builtin: after.builtin,
        relinkedRoots: relinked,
        alreadyApplied: false,
        configHash: configHash(cwd),
      } satisfies RenameRootResponse);
    } catch (err) {
      // A throw after the journal was written leaves it on disk on purpose —
      // startup replays it rather than guessing here, mid-request.
      return fail('VALIDATION', (err as Error).message, { rootId });
    } finally {
      inProgress.delete(cwd);
    }
  });

  return router;
}
