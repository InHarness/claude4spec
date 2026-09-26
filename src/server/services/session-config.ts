import path from 'node:path';
import type { NormalizedConfig } from '../config.js';
import { STATIC_FIELD_REGISTRY } from '../settings/registry.js';
import { fieldPath, getPath } from '../settings/field-registry.js';

/**
 * 0.2.113 — the config half of the resume-config snapshot.
 *
 * A turn-1 snapshot (`chat_thread.initial_architecture_config_json`) already held the
 * model, the reasoning config and the RESOLVED path scope. Two things join it:
 *
 *  - `lockedConfig` — the value of every field its declarant marked `resumeLock`
 *    (`agent.allowedPaths`, `agent.disallowedPaths`, the filesystem posture, the five
 *    artifact dirs), recorded as CONFIG, not as resolved paths. Resuming a thread
 *    founded under another value of any of them is refused. Comparing declarations
 *    rather than the resolved lists is what keeps a change of `roots[]` — which moves
 *    the implicit base of the scope, but is not a locked field — from locking a thread.
 *  - `promptConfig` — the `new-thread` inputs of the system prompt (name, languages,
 *    writing style). A resumed thread keeps them: a changed writing style reaches the
 *    first turn of a NEW thread, and a running one keeps its `<project_writing_skill/>`
 *    block — WITHOUT refusing the resume.
 *
 * Both are optional on read: a snapshot written before 0.2.113 has neither, and falls
 * back to the pre-0.2.113 behaviour (resolved-scope comparison, current config).
 */
export interface ThreadPromptConfig {
  name: string;
  language: string | null;
  conversationalLanguage: string | null;
  writingStyle: string | null;
}

export interface SessionConfigSnapshot {
  lockedConfig?: Record<string, unknown>;
  promptConfig?: ThreadPromptConfig;
  /** The session's resolved scope — reused verbatim on every resumed turn. */
  allowedPaths?: string[];
  disallowedPaths?: string[];
  pageRootDirs?: string[];
}

export function captureLockedConfig(cfg: NormalizedConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of STATIC_FIELD_REGISTRY.resumeLockedKeys()) {
    out[key] = getPath(cfg, fieldPath(STATIC_FIELD_REGISTRY.get(key)!));
  }
  return out;
}

export function captureThreadPromptConfig(cfg: NormalizedConfig): ThreadPromptConfig {
  return {
    name: cfg.name,
    language: cfg.language,
    conversationalLanguage: cfg.agent.conversationalLanguage,
    writingStyle: cfg.writingStyle,
  };
}

/** Parse the stored snapshot's 0.2.113 half; anything malformed reads as absent. */
export function parseSessionConfigSnapshot(raw: string | null): SessionConfigSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const strings = (v: unknown): string[] | undefined =>
      Array.isArray(v) && v.every((p) => typeof p === 'string') ? (v as string[]) : undefined;
    const locked = parsed.lockedConfig;
    const prompt = parsed.promptConfig as Record<string, unknown> | undefined;
    const allowedPaths = strings(parsed.allowedPaths);
    const disallowedPaths = strings(parsed.disallowedPaths);
    const pageRootDirs = strings(parsed.pageRootDirs);
    return {
      ...(locked && typeof locked === 'object' && !Array.isArray(locked)
        ? { lockedConfig: locked as Record<string, unknown> }
        : {}),
      ...(prompt && typeof prompt === 'object' && typeof prompt.name === 'string'
        ? {
            promptConfig: {
              name: prompt.name,
              language: typeof prompt.language === 'string' ? prompt.language : null,
              conversationalLanguage:
                typeof prompt.conversationalLanguage === 'string' ? prompt.conversationalLanguage : null,
              writingStyle: typeof prompt.writingStyle === 'string' ? prompt.writingStyle : null,
            },
          }
        : {}),
      ...(allowedPaths ? { allowedPaths } : {}),
      ...(disallowedPaths ? { disallowedPaths } : {}),
      ...(pageRootDirs ? { pageRootDirs } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * A list field is a SET here — reordering the same entries in Settings is not a
 * change. Nor is a spelling of the same directory (`./x`, `x/`, `x/./`): the
 * pre-0.2.113 comparison ran on resolved paths, so it never locked on one either.
 */
const canonicalPath = (p: string): string => path.normalize(p).replace(/[\\/]+$/, '');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify([...new Set(value.map((v) => canonicalPath(String(v))))].sort());
  if (typeof value === 'string') return JSON.stringify(canonicalPath(value));
  return JSON.stringify(value ?? null);
}

/**
 * Locked fields whose current value differs from the snapshot's. A key the snapshot
 * does not carry is not comparable and never a violation — the same "absent ⇒ not
 * comparable" rule the library applies to every other constraint.
 */
export function findLockedConfigViolations(
  lockedConfig: Record<string, unknown>,
  cfg: NormalizedConfig,
): { path: string; reason: string }[] {
  const out: { path: string; reason: string }[] = [];
  for (const key of STATIC_FIELD_REGISTRY.resumeLockedKeys()) {
    if (!(key in lockedConfig)) continue;
    const current = getPath(cfg, fieldPath(STATIC_FIELD_REGISTRY.get(key)!));
    if (canonical(lockedConfig[key]) === canonical(current)) continue;
    out.push({
      path: key,
      reason:
        key === 'agent.disableDirectFilesystemAccess'
          ? 'Direct filesystem access is fixed for the lifetime of a session; a capability gate must not shrink or grow mid-session. Start a new conversation to use the new setting.'
          : `${key} is fixed for the lifetime of a session — the agent's file scope was set when the conversation started. Start a new conversation to use the new setting.`,
    });
  }
  return out;
}
