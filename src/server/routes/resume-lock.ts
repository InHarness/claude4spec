import { findResumeViolations } from '@inharness-ai/agent-adapters';
import {
  normalizeResumePathScope,
  resolveAgentExecutionScope,
} from '../services/agent-execution-scope.js';
import { readConfig } from '../config.js';
import { findLockedConfigViolations, parseSessionConfigSnapshot } from '../services/session-config.js';
import type { Root } from '../../shared/types.js';
import type { ActiveAdapter } from './agent-turn.js';

/**
 * 0.2.111 (M46): is a turn in flight on this thread, or on ANY row resuming the same
 * CLI session? Since a banka continuation founds a new row that copies the banka's
 * `last_session_id`, two rows may point at one session — and an unforked parallel
 * resume interleaves its transcript. So the one-stream guard is per SESSION, not per
 * row, at every turn-starting entry point: `POST /api/chat`, `POST /api/threads/:id/ask`
 * and the banka continuation in `TransagentDispatcher`.
 */
export function isSessionInFlight(
  activeAdapters: ReadonlyMap<string, Pick<ActiveAdapter, 'sessionId'>>,
  threadId: string,
  sessionId: string | null | undefined,
): boolean {
  if (activeAdapters.has(threadId)) return true;
  if (!sessionId) return false;
  for (const entry of activeAdapters.values()) {
    if (entry.sessionId === sessionId) return true;
  }
  return false;
}

/** The 409 body shape both turn-starting routes return. `violations` is the UI contract. */
export interface ResumeConfigLockError {
  error: {
    code: 'RESUME_CONFIG_LOCKED';
    message: string;
    violations: { path: string; reason: string }[];
  };
}

export interface ResumeLockInput {
  /** Turn-1 snapshot as stored (raw JSON string), or null for a thread that never ran. */
  snapshotJson: string | null;
  /** Session id of the thread — null/undefined means "not resuming", so nothing is locked. */
  lastSessionId: string | null;
  model: string;
  architectureConfig: Record<string, unknown>;
  cwd: string;
  roots: Root[];
}

/**
 * M05 session-lock, shared by THREE entry points — `POST /api/chat`,
 * `POST /api/threads/:id/ask` (both map a violation to HTTP 409) and, since 0.2.111,
 * the banka continuation in `TransagentDispatcher` (`runTransagent({ threadId })`),
 * which compares against the referenced banka's snapshot BEFORE founding the new row
 * and maps a violation to a tool refusal `RESUME_CONFIG_LOCKED` instead. On a
 * resuming turn the model, the reasoning fields AND (0.2.8, C15) the FS path scope are
 * immutable. claude-code binds the last turn's thinking blocks to the config that produced
 * them, and the library declares `allowedPaths`/`disallowedPaths` frozen for a session's
 * lifetime; changing either on resume is a hard error upstream, so we reject it here first.
 *
 * MUST run before the SSE headers are flushed — afterwards the status can no longer be set.
 *
 * Returns the 409 body, or `null` when the turn may proceed.
 *
 * The path scope is recomputed from config here (not taken from the request) because that
 * is what the turn will actually run with; it goes through the same
 * `resolveAgentExecutionScope` + `normalizeResumePathScope` pair that wrote the snapshot, so
 * the two sides are comparable and a mere reordering of the same paths is not a violation.
 */
export function checkResumeConfigLock(input: ResumeLockInput): ResumeConfigLockError | null {
  if (input.lastSessionId == null || !input.snapshotJson) return null;
  const snapshot = JSON.parse(input.snapshotJson) as Record<string, unknown>;
  const session = parseSessionConfigSnapshot(input.snapshotJson);
  const cfg = readConfig(input.cwd);

  /**
   * 0.2.113: a snapshot that records `lockedConfig` is compared on the DECLARED
   * fields (see `session-config.ts`), and the resumed turn runs on the snapshot's own
   * resolved scope — so the library is handed that same scope and cannot see a
   * difference. The resolved-list comparison below survives only for snapshots
   * written before 0.2.113, which carry no declarations to compare.
   */
  if (session?.lockedConfig) {
    const violations = findResumeViolations('claude-code', snapshot, {
      model: input.model,
      architectureConfig: input.architectureConfig,
    });
    violations.push(...findLockedConfigViolations(session.lockedConfig, cfg));
    return violations.length === 0 ? null : lockedError(violations);
  }

  const scope = resolveAgentExecutionScope({ cwd: input.cwd, roots: input.roots });
  const violations = findResumeViolations('claude-code', snapshot, {
    model: input.model,
    architectureConfig: input.architectureConfig,
    allowedPaths: normalizeResumePathScope(scope.allowedPaths),
    disallowedPaths: normalizeResumePathScope(scope.disallowedPaths),
  });

  /**
   * 0.2.53 — the tool-gating axis, compared HERE and not by the library, and the
   * difference is the entire point.
   *
   * `findResumeViolations` does know `disallowedToolGroups`, and locks it — but
   * it locks the RESOLVED UNION, into which `planMode` desugars. Handing it our
   * groups would therefore turn every mid-thread Plan Mode flip into a 409,
   * because plan mode produces the same `file-write` + `shell` pair the project
   * constant does. So we never pass them, and compare the CONFIG FIELD the
   * turn-1 snapshot recorded instead: the flag is fixed for a thread's lifetime,
   * plan mode stays a per-turn switch.
   *
   * A snapshot written before this field existed has no value for it, and
   * nothing is locked in that case — the same "absent ⇒ not comparable" rule the
   * library applies to every other constraint. (Absence arguably means `false` —
   * every pre-0.2.53 thread ran WITH the built-ins — but reading it that way would
   * make every conversation predating the upgrade unresumable in one step, whereas
   * the shrink it avoids is fail-closed and announced to the model on every resumed
   * turn by `<agent_filesystem_access>`.)
   */
  const snapshotFlag = snapshot.disableDirectFilesystemAccess;
  const currentFlag = cfg.agent.disableDirectFilesystemAccess;
  if (typeof snapshotFlag === 'boolean' && snapshotFlag !== currentFlag) {
    violations.push({
      path: 'agent.disableDirectFilesystemAccess',
      reason:
        'Direct filesystem access is fixed for the lifetime of a session; a capability gate must not shrink or grow mid-session. Start a new conversation to use the new setting.',
    });
  }

  return violations.length === 0 ? null : lockedError(violations);
}

function lockedError(violations: { path: string; reason: string }[]): ResumeConfigLockError {
  return {
    error: {
      code: 'RESUME_CONFIG_LOCKED',
      // Deliberately STATIC and identical on both routes. The per-field detail is not this
      // string's job — it belongs in `violations[]`, whose `path`/`reason` pairs let the UI
      // lock exactly the control that diverged. Interpolating the field names here instead
      // would give non-UI consumers (`c4s ask`, scripts) an unstable message to match on.
      message:
        'Model, reasoning and filesystem scope are locked for the lifetime of a session. Start a new conversation to use the new settings.',
      violations: violations.map((v) => ({ path: v.path, reason: v.reason })),
    },
  };
}
