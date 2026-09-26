import type { NormalizedConfig } from '../config.js';
import type { Root } from '../../shared/types.js';
import type { SkillRegistry } from '../services/skill-registry.js';

/**
 * 0.2.113 — the settings module as INFRASTRUCTURE: the field registry.
 *
 * Until 0.2.112 the settings module knew every field of `config.json` itself — the
 * PATCH handler carried one hand-written `if ('x' in body)` block per key, and which
 * fields rebuilt the context or locked a resume lived in three unrelated lists. Now
 * every key of the file has exactly ONE declarant: the module it belongs to. A
 * declaration is one row of
 *
 *   Key | Type | Default | Validation | Effect class | Resume lock | API writable
 *
 * and everything the settings module does with a field is derived from that row:
 * the PATCH whitelist (`apiWritable`), the rebuild trigger (`effect ===
 * 'context-rebuild'`), and the resume-config snapshot (`resumeLock`).
 *
 * Two declarants of one key is a REGISTRATION error, thrown at build time — the
 * whole point is that nobody has to guess which module answers for a field.
 */

/**
 * When a saved change starts to act. The client never names the class — it shows the
 * declarant's `effectMessage` — but the server derives its reaction from it:
 *
 *  - `per-operation`   — the next operation that reads the field;
 *  - `per-turn`        — the next agent turn, existing threads included;
 *  - `new-thread`      — the first turn of a NEW thread only;
 *  - `context-rebuild` — the next request, after the `ProjectContext` is invalidated
 *                        (services, watchers, `indexAll()`), with no process restart.
 */
export type EffectClass = 'per-operation' | 'per-turn' | 'new-thread' | 'context-rebuild';

/**
 * Stage 1 of validation — the wire type. Deliberately a closed set: a field whose
 * shape does not fit one of these is `object` and its own rule does the rest.
 */
export type FieldType =
  | 'string'
  | 'string|null'
  | 'boolean'
  | 'string[]'
  | 'object'
  | { enum: readonly string[] };

/** What a field rule (stage 2) and a cross-field rule (stage 3) can see. */
export interface FieldValidationContext {
  cwd: string;
  /** Config as stored BEFORE this request. */
  current: NormalizedConfig;
  skillRegistry: SkillRegistry;
  /**
   * Roots the running context was built from (`--pages` override applied); falls
   * back to `current.roots` when the caller has none.
   */
  effectiveRoots: Root[];
  /** Keys (dotted) the request actually carries, after the whitelist. */
  touched: ReadonlySet<string>;
}

/**
 * A stage-2 outcome. `value` lets a rule normalize what it accepts (trim, `'' → null`);
 * a `warning` never blocks the write — it is logged and returned to the caller.
 */
export type FieldRuleResult =
  | { ok: true; value?: unknown; warning?: string }
  | { ok: false; error: string };

export type FieldRule = (
  value: unknown,
  ctx: FieldValidationContext,
) => FieldRuleResult | Promise<FieldRuleResult>;

export interface FieldDeclaration {
  /** Dotted path into `config.json` (`agent.allowedPaths`, `plugins.<name>.<key>`). */
  key: string;
  /**
   * The key's segments, when a segment itself may contain a dot — a plugin's
   * `manifest.name` is a package name. Absent ⇒ `key.split('.')`.
   */
  path?: readonly string[];
  /** The module that answers for the field. Documentary, and named in collision errors. */
  owner: string;
  type: FieldType;
  /** The default a missing field gets. Documentary here — `config.ts` applies it. */
  default: unknown;
  /**
   * Stage 2. A rule is the server half of the field's validation; a check the spec
   * marks `UI:` lives only in the browser and never appears here.
   */
  validate?: FieldRule;
  effect: EffectClass;
  /**
   * `true` puts the field into the resume-config snapshot: resuming a thread founded
   * under another value of it is refused with `409 RESUME_CONFIG_LOCKED`. A save of
   * the field always goes through — the lock is enforced on resume, not on write.
   */
  resumeLock: boolean;
  /** `false` = hand-editable only; PATCH drops the key silently. */
  apiWritable: boolean;
}

/**
 * Stage 3 — a rule over several fields at once. Runs only when the request touches
 * one of `touches`, so a config already broken elsewhere stays repairable field by
 * field: an unrelated PATCH never fails on damage it did not cause.
 */
export interface CrossFieldRule {
  owner: string;
  /** Rule id, for collision errors and logs. */
  id: string;
  touches: readonly string[];
  check: (
    effective: (key: string) => unknown,
    ctx: FieldValidationContext,
  ) => Promise<CrossFieldResult> | CrossFieldResult;
}

export type CrossFieldResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; error: string; key: string };

export class FieldRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldRegistrationError';
  }
}

export class FieldRegistry {
  private readonly fields = new Map<string, FieldDeclaration>();
  private readonly crossRules = new Map<string, CrossFieldRule>();

  register(...decls: FieldDeclaration[]): this {
    for (const d of decls) {
      const existing = this.fields.get(d.key);
      if (existing) {
        throw new FieldRegistrationError(
          `config field "${d.key}" is declared twice — by "${existing.owner}" and by "${d.owner}"`,
        );
      }
      // A key and one of its ancestors cannot both be leaves: whichever wins, the
      // other one's writes would silently clobber or be clobbered.
      const mine = fieldPath(d);
      for (const [other, otherDecl] of this.fields) {
        const theirs = fieldPath(otherDecl);
        const n = Math.min(mine.length, theirs.length);
        if (mine.length !== theirs.length && mine.slice(0, n).every((seg, i) => seg === theirs[i])) {
          throw new FieldRegistrationError(
            `config field "${d.key}" (${d.owner}) overlaps "${other}" (${this.fields.get(other)!.owner})`,
          );
        }
      }
      this.fields.set(d.key, d);
    }
    return this;
  }

  registerCrossFieldRule(rule: CrossFieldRule): this {
    if (this.crossRules.has(rule.id)) {
      throw new FieldRegistrationError(`cross-field rule "${rule.id}" is registered twice`);
    }
    this.crossRules.set(rule.id, rule);
    return this;
  }

  get(key: string): FieldDeclaration | undefined {
    return this.fields.get(key);
  }

  list(): FieldDeclaration[] {
    return [...this.fields.values()];
  }

  crossFieldRules(): CrossFieldRule[] {
    return [...this.crossRules.values()];
  }

  /** Keys whose change is locked for a session's lifetime (the resume-config snapshot). */
  resumeLockedKeys(): string[] {
    return this.list().filter((d) => d.resumeLock).map((d) => d.key);
  }

  /** Keys whose save invalidates the `ProjectContext`. */
  contextRebuildKeys(): string[] {
    return this.list().filter((d) => d.effect === 'context-rebuild').map((d) => d.key);
  }
}

// ── helpers shared by the PATCH handler and the declarants ──────────────────────

export type FieldPath = string | readonly string[];

const segmentsOf = (key: FieldPath): readonly string[] => (typeof key === 'string' ? key.split('.') : key);

/** The segments of a declaration's key. */
export function fieldPath(d: Pick<FieldDeclaration, 'key' | 'path'>): readonly string[] {
  return d.path ?? d.key.split('.');
}

/** `true` when the path exists in `obj` (an explicit `null` counts). */
export function hasPath(obj: unknown, key: FieldPath): boolean {
  let cur: unknown = obj;
  for (const seg of segmentsOf(key)) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return false;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return false;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return true;
}

export function getPath(obj: unknown, key: FieldPath): unknown {
  let cur: unknown = obj;
  for (const seg of segmentsOf(key)) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, key: FieldPath, value: unknown): void {
  const segs = segmentsOf(key);
  let cur = obj;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

function describeType(t: FieldType): string {
  if (typeof t === 'object') return t.enum.map((v) => `'${v}'`).join(' | ');
  if (t === 'string|null') return 'string | null';
  return t;
}

/** Stage 1. Returns an error message pinned to `key`, or `null` when the type fits. */
export function checkFieldType(key: string, type: FieldType, value: unknown): string | null {
  const fits = (() => {
    if (typeof type === 'object') return typeof value === 'string' && type.enum.includes(value);
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'string|null':
        return value === null || typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      case 'string[]':
        return Array.isArray(value) && value.every((v) => typeof v === 'string');
      case 'object':
        return value !== null && typeof value === 'object';
    }
  })();
  return fits ? null : `${key} must be ${describeType(type)}`;
}
