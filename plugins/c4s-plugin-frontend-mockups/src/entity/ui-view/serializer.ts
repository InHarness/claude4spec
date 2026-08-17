import type { RawEntity } from '../../host-kit/host-types.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializationContribution,
} from '@c4s/plugin-runtime';
import { contentBytes } from '@c4s/plugin-runtime';
import type { UiViewParam, UiViewParamLocation } from '../../types.js';
import { uiViewPayloadUpgrades } from './upgrades.js';

// ─── M17 Snapshot shape (entities/ui-view.md `uvsn0sho`) ────────────────────

export interface UiViewSnapshot {
  slug: string;
  title: string;
  url: string | null;
  description: string | null;
  params: UiViewParam[];
  /** v0.1.59 (serializer 1.1.0, additive): referenced design-system slug, or null. */
  designSystemSlug: string | null;
  /**
   * The mockup — FULL CONTENT, `contentBearing` notwithstanding.
   *
   * The flag governs READS, not serialisation. Dropping the blob here would stop
   * the entity file being the source of truth and would make
   * `snapshot → restore → snapshot` lose the mockup, so it stays, literally and
   * without trim. The snapshot and the full read record are the same shape apart
   * from exactly this field: the record carries descriptors, the snapshot carries
   * the content.
   */
  mockupHtml: string | null;
  tags: string[];
}

function coerceUiView(raw: unknown): UiViewSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: String(r.slug ?? ''),
    title: String(r.title ?? ''),
    url: (r.url as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    params: Array.isArray(r.params) ? (r.params as UiViewParam[]) : [],
    designSystemSlug:
      typeof r.designSystemSlug === 'string' && r.designSystemSlug ? r.designSystemSlug : null,
    mockupHtml: typeof r.mockupHtml === 'string' ? r.mockupHtml : null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function uiViewDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'ui-view', slug, op: 'noop' };
  if (a == null) return { type: 'ui-view', slug, op: 'created' };
  if (b == null) return { type: 'ui-view', slug, op: 'deleted' };
  const sa = coerceUiView(a);
  const sb = coerceUiView(b);
  const changes: Record<string, unknown> = {};

  const metaChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  if (sa.title !== sb.title) metaChanges.push({ field: 'title', from: sa.title, to: sb.title });
  if (sa.url !== sb.url) metaChanges.push({ field: 'url', from: sa.url, to: sb.url });
  if (sa.description !== sb.description) metaChanges.push({ field: 'description', from: sa.description, to: sb.description });
  // v0.1.59: null ↔ slug = assigning / detaching a design system (atomic field change).
  if (sa.designSystemSlug !== sb.designSystemSlug)
    metaChanges.push({ field: 'designSystemSlug', from: sa.designSystemSlug, to: sb.designSystemSlug });
  if (metaChanges.length) changes.meta_changes = metaChanges;

  // Params keyed by name (collect all `in` variants per name to detect in_changed)
  const aByNameIn = new Map(sa.params.map((p) => [`${p.name}|${p.in}`, p]));
  const bByNameIn = new Map(sb.params.map((p) => [`${p.name}|${p.in}`, p]));
  const aByName = new Map<string, UiViewParam>();
  for (const p of sa.params) aByName.set(p.name, p);
  const bByName = new Map<string, UiViewParam>();
  for (const p of sb.params) bByName.set(p.name, p);

  const paramAdded: Array<{ name: string; in: UiViewParamLocation; required: boolean }> = [];
  const paramRemoved: Array<{ name: string; in: UiViewParamLocation; required: boolean }> = [];
  const paramModified: Array<Record<string, unknown>> = [];
  const inChanged: Array<{ name: string; from: UiViewParamLocation; to: UiViewParamLocation }> = [];

  for (const [k, p] of bByNameIn) {
    if (aByNameIn.has(k)) continue;
    const aSameName = aByName.get(p.name);
    if (aSameName && !bByNameIn.has(`${p.name}|${aSameName.in}`)) {
      // name preserved but `in` changed — single in_changed event (only emit once per name)
      if (!inChanged.find((i) => i.name === p.name)) {
        inChanged.push({ name: p.name, from: aSameName.in, to: p.in });
      }
    } else {
      paramAdded.push({ name: p.name, in: p.in, required: !!p.required });
    }
  }
  for (const [k, p] of aByNameIn) {
    if (bByNameIn.has(k)) continue;
    const bSameName = bByName.get(p.name);
    if (bSameName && !aByNameIn.has(`${p.name}|${bSameName.in}`)) {
      // covered by in_changed above
    } else {
      paramRemoved.push({ name: p.name, in: p.in, required: !!p.required });
    }
  }
  for (const [k, p] of aByNameIn) {
    const other = bByNameIn.get(k);
    if (!other) continue;
    const pm: Record<string, unknown> = { name: p.name, in: p.in };
    if ((p.type ?? null) !== (other.type ?? null)) pm.type_changed = { from: p.type ?? null, to: other.type ?? null };
    if (!!p.required !== !!other.required) pm.required_changed = { from: !!p.required, to: !!other.required };
    if ((p.default ?? null) !== (other.default ?? null)) pm.default_changed = { from: p.default ?? null, to: other.default ?? null };
    if ((p.description ?? null) !== (other.description ?? null)) pm.description_changed = { from: p.description ?? null, to: other.description ?? null };
    if (Object.keys(pm).length > 2) paramModified.push(pm);
  }
  if (paramAdded.length) changes.param_added = paramAdded;
  if (paramRemoved.length) changes.param_removed = paramRemoved;
  if (paramModified.length) changes.param_modified = paramModified;
  if (inChanged.length) changes.in_changed = inChanged;

  /**
   * The mockup, in BYTES — a sibling field, deliberately not a `meta_changes`
   * entry.
   *
   * `meta_changes[].field` is a closed set of things with a readable `from`/`to`,
   * and a blob of tens of kilobytes has neither. What a reader can use is whether
   * it changed and by how much, which is the shape the host's default diff
   * already gives every `contentBearing` field (`<field>_changed`). This type
   * OVERRIDES `diff`, so it does not get that for free and says it here instead —
   * without which the mockup would vanish from release diffs silently, which is
   * the one thing the flag must not cause.
   *
   * Reported for an appearance and a removal too: for content, "it appeared" and
   * "it grew from nothing" are one event, and `{ fromBytes: 0, toBytes: n }` says
   * it in the shape a reader already had to learn.
   */
  if (sa.mockupHtml !== sb.mockupHtml) {
    changes.mockup_changed = {
      fromBytes: contentBytes(sa.mockupHtml),
      toBytes: contentBytes(sb.mockupHtml),
    };
  }

  // Tags
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'ui-view', slug, op: 'noop' };
  return { type: 'ui-view', slug, op: 'modified', changes };
}

/** 0.2.24 — spread onto the type; the `serializer` wrapper is rejected now. */
export const uiViewSerialization = {
  /** v1 files spell the label `name`. */
  payloadUpgrades: uiViewPayloadUpgrades,
  diff: uiViewDiff,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades' | 'diff'>;

