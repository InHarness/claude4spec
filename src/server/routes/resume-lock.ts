import { findResumeViolations } from '@inharness-ai/agent-adapters';
import {
  normalizeResumePathScope,
  resolveAgentExecutionScope,
} from '../services/agent-execution-scope.js';
import type { Root } from '../../shared/types.js';

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
 * M05 session-lock, shared by `POST /api/chat` and `POST /api/threads/:id/ask`: on a
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
  const scope = resolveAgentExecutionScope({ cwd: input.cwd, roots: input.roots });
  const violations = findResumeViolations('claude-code', JSON.parse(input.snapshotJson), {
    model: input.model,
    architectureConfig: input.architectureConfig,
    allowedPaths: normalizeResumePathScope(scope.allowedPaths),
    disallowedPaths: normalizeResumePathScope(scope.disallowedPaths),
  });
  if (violations.length === 0) return null;
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
