import type { RawEntity } from '../../host-kit/host-types.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializationContribution,
} from '@c4s/plugin-runtime';
import type { DesignMode, TokenGroup, TokenValue } from '../../types.js';
import { parseGroups, parseModes, resolve } from '../../design-system-domain.js';
import { designSystemPayloadV1ToV2, designSystemPayloadV2ToV3 } from './upgrades.js';

// ─── snapshot shape (committed file format) ─────────────────────────────────

export interface DesignSystemSnapshotToken {
  name: string;
  type: string;
  value: TokenValue;
  description: string | null;
}

export interface DesignSystemSnapshotGroup {
  name: string;
  tier: 'primitive' | 'semantic';
  tokens: DesignSystemSnapshotToken[];
}

export interface DesignSystemSnapshot {
  slug: string;
  title: string;
  description: string | null;
  groups: DesignSystemSnapshotGroup[];
  modes: Array<{ name: string; overrides: Array<{ token: string; value: TokenValue }> }>;
  tags: string[];
}

// ─── view helpers ────────────────────────────────────────────────────────────

// ─── snapshot / restore / diff ──────────────────────────────────────────────

function coerce(raw: unknown): DesignSystemSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: String(r.slug ?? ''),
    title: String(r.title ?? ''),
    description: (r.description as string | null) ?? null,
    groups: parseGroups(r.groups).map((g) => ({
      name: g.name,
      tier: g.tier,
      tokens: g.tokens.map((t) => ({
        name: t.name,
        type: t.type,
        value: t.value,
        description: t.description ?? null,
      })),
    })),
    modes: parseModes(r.modes),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function valueEq(a: TokenValue, b: TokenValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function designSystemDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'design-system', slug, op: 'noop' };
  if (a == null) return { type: 'design-system', slug, op: 'created' };
  if (b == null) return { type: 'design-system', slug, op: 'deleted' };
  const sa = coerce(a);
  const sb = coerce(b);
  const changes: Record<string, unknown> = {};

  // meta
  const metaChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  if (sa.title !== sb.title) metaChanges.push({ field: 'title', from: sa.title, to: sb.title });
  if (sa.description !== sb.description)
    metaChanges.push({ field: 'description', from: sa.description, to: sb.description });
  if (metaChanges.length) changes.meta_changes = metaChanges;

  // groups by name
  const aGroups = new Map(sa.groups.map((g) => [g.name, g]));
  const bGroups = new Map(sb.groups.map((g) => [g.name, g]));
  const groupAdded: Array<{ name: string; tier: string }> = [];
  const groupRemoved: Array<{ name: string; tier: string }> = [];
  for (const [name, g] of bGroups) if (!aGroups.has(name)) groupAdded.push({ name, tier: g.tier });
  for (const [name, g] of aGroups) if (!bGroups.has(name)) groupRemoved.push({ name, tier: g.tier });
  if (groupAdded.length) changes.group_added = groupAdded;
  if (groupRemoved.length) changes.group_removed = groupRemoved;

  // tokens by (group, name)
  type TokKey = string;
  /**
   * NUL as the delimiter, because it is the one character a group or token name
   * cannot contain — so no two distinct pairs collide on one composite key.
   *
   * Written as an ESCAPE, not as a literal NUL byte. It was the raw byte until
   * 0.2.9, which made git treat this entire file as BINARY: its diffs rendered
   * as `Bin 11514 -> 9420 bytes` with no reviewable content, and `grep` skipped
   * it silently. Both cost real time in this tier — a grep for `sort` in here
   * came back empty and was read as "this file does not sort", which is the
   * opposite of true. Same value, same behaviour, reviewable diff.
   */
  const tokKey = (group: string, name: string): TokKey => `${group}\u0000${name}`;
  const aTokens = new Map<TokKey, { group: string; tok: DesignSystemSnapshotToken }>();
  const bTokens = new Map<TokKey, { group: string; tok: DesignSystemSnapshotToken }>();
  for (const g of sa.groups) for (const t of g.tokens) aTokens.set(tokKey(g.name, t.name), { group: g.name, tok: t });
  for (const g of sb.groups) for (const t of g.tokens) bTokens.set(tokKey(g.name, t.name), { group: g.name, tok: t });

  const tokenAdded: Array<{ group: string; name: string; type: string }> = [];
  const tokenRemoved: Array<{ group: string; name: string; type: string }> = [];
  const tokenModified: Array<Record<string, unknown>> = [];
  for (const [k, { group, tok }] of bTokens) {
    if (!aTokens.has(k)) tokenAdded.push({ group, name: tok.name, type: tok.type });
  }
  for (const [k, { group, tok }] of aTokens) {
    if (!bTokens.has(k)) tokenRemoved.push({ group, name: tok.name, type: tok.type });
  }
  for (const [k, { group, tok }] of aTokens) {
    const other = bTokens.get(k);
    if (!other) continue;
    const ot = other.tok;
    const pm: Record<string, unknown> = { group, name: tok.name };
    if (tok.type !== ot.type) pm.type_changed = { from: tok.type, to: ot.type };
    if (!valueEq(tok.value, ot.value)) pm.value_changed = { from: tok.value, to: ot.value };
    if ((tok.description ?? null) !== (ot.description ?? null))
      pm.description_changed = { from: tok.description ?? null, to: ot.description ?? null };
    if (Object.keys(pm).length > 2) tokenModified.push(pm);
  }
  if (tokenAdded.length) changes.token_added = tokenAdded;
  if (tokenRemoved.length) changes.token_removed = tokenRemoved;
  if (tokenModified.length) changes.token_modified = tokenModified;

  // modes by name
  const aModes = new Map(sa.modes.map((m) => [m.name, m]));
  const bModes = new Map(sb.modes.map((m) => [m.name, m]));
  const modeAdded: string[] = [];
  const modeRemoved: string[] = [];
  const modeModified: Array<{ name: string; override_changes: number }> = [];
  for (const name of bModes.keys()) if (!aModes.has(name)) modeAdded.push(name);
  for (const name of aModes.keys()) if (!bModes.has(name)) modeRemoved.push(name);
  for (const [name, am] of aModes) {
    const bm = bModes.get(name);
    if (!bm) continue;
    const aOv = new Map(am.overrides.map((o) => [o.token, o.value]));
    const bOv = new Map(bm.overrides.map((o) => [o.token, o.value]));
    let count = 0;
    for (const [tk, v] of bOv) if (!aOv.has(tk) || !valueEq(aOv.get(tk)!, v)) count += 1;
    for (const tk of aOv.keys()) if (!bOv.has(tk)) count += 1;
    if (count > 0) modeModified.push({ name, override_changes: count });
  }
  if (modeAdded.length) changes.mode_added = modeAdded;
  if (modeRemoved.length) changes.mode_removed = modeRemoved;
  if (modeModified.length) changes.mode_modified = modeModified;

  // tags as set
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'design-system', slug, op: 'noop' };
  return { type: 'design-system', slug, op: 'modified', changes };
}

// ─── schemas ─────────────────────────────────────────────────────────────────

/**
 * 0.2.23 — `resolve()` stays; the view that called it does not.
 *
 * `single_element` emitted each token twice: the raw `value` as authored and a
 * `resolvedValue` with `{token}` aliases expanded in Base mode. Expanding an
 * alias is a presentation decision — which mode, at what moment — and the record
 * now carries the raw value alone. `resolve()` itself is untouched and has the
 * two callers it always really had: `frontend.renderCard` and the live preview
 * in the detail panel.
 */
export const designSystemSerializer: SerializationContribution<RawEntity> = {
  diff: designSystemDiff,

  /** v1 files carry a synthesised `description: null` on every token; v2 files spell the label `name`. */
  payloadUpgrades: [designSystemPayloadV1ToV2, designSystemPayloadV2ToV3],
};
