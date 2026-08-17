import type { RawEntity } from '../../host-kit/host-types.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializationContribution,
} from '@c4s/plugin-runtime';
import type { DtoExample, DtoField } from '../../types.js';
import { dtoPayloadUpgrades } from './upgrades.js';

// ─── M17 Snapshot shape (entities/dto.md `dtosn0sho`) ───────────────────────

export interface DtoSnapshot {
  slug: string;
  title: string;
  description: string | null;
  fields: DtoField[];
  examples: DtoExample[];
  tags: string[];
}

function coerceDto(raw: unknown): DtoSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: String(r.slug ?? ''),
    title: String(r.title ?? ''),
    description: (r.description as string | null) ?? null,
    fields: Array.isArray(r.fields) ? (r.fields as DtoField[]) : [],
    examples: Array.isArray(r.examples) ? (r.examples as DtoExample[]) : [],
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function dtoDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'dto', slug, op: 'noop' };
  if (a == null) return { type: 'dto', slug, op: 'created' };
  if (b == null) return { type: 'dto', slug, op: 'deleted' };
  const sa = coerceDto(a);
  const sb = coerceDto(b);
  const changes: Record<string, unknown> = {};

  // Meta
  const metaChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  if (sa.title !== sb.title) metaChanges.push({ field: 'title', from: sa.title, to: sb.title });
  if (sa.description !== sb.description) metaChanges.push({ field: 'description', from: sa.description, to: sb.description });
  if (metaChanges.length) changes.meta_changes = metaChanges;

  // Fields by name
  const aFields = new Map(sa.fields.map((f) => [f.name, f]));
  const bFields = new Map(sb.fields.map((f) => [f.name, f]));
  const fieldAdded: Array<{ name: string; type: string; required: boolean }> = [];
  const fieldRemoved: Array<{ name: string; type: string; required: boolean }> = [];
  const fieldModified: Array<Record<string, unknown>> = [];
  for (const [name, f] of bFields) {
    if (!aFields.has(name)) fieldAdded.push({ name, type: f.type, required: f.required });
  }
  for (const [name, f] of aFields) {
    const other = bFields.get(name);
    if (!other) {
      fieldRemoved.push({ name, type: f.type, required: f.required });
      continue;
    }
    const fc: Record<string, unknown> = { name };
    if (f.type !== other.type) fc.type_changed = { from: f.type, to: other.type };
    if (f.required !== other.required) fc.required_changed = { from: f.required, to: other.required };
    if (f.description !== other.description) fc.description_changed = { from: f.description ?? null, to: other.description ?? null };
    if (Object.keys(fc).length > 1) fieldModified.push(fc);
  }
  if (fieldAdded.length) changes.field_added = fieldAdded;
  if (fieldRemoved.length) changes.field_removed = fieldRemoved;
  if (fieldModified.length) changes.field_modified = fieldModified;

  // Examples by name
  const aEx = new Map(sa.examples.map((e) => [e.name, e]));
  const bEx = new Map(sb.examples.map((e) => [e.name, e]));
  const exAdded: Array<{ name: string }> = [];
  const exRemoved: Array<{ name: string }> = [];
  const exModified: Array<{ name: string; summary_changed?: boolean; value_changed?: boolean }> = [];
  for (const [name] of bEx) if (!aEx.has(name)) exAdded.push({ name });
  for (const [name, e] of aEx) {
    const other = bEx.get(name);
    if (!other) { exRemoved.push({ name }); continue; }
    const summaryChanged = (e.summary ?? null) !== (other.summary ?? null);
    const valueChanged = JSON.stringify(e.value) !== JSON.stringify(other.value);
    if (summaryChanged || valueChanged) {
      exModified.push({
        name,
        ...(summaryChanged ? { summary_changed: true } : {}),
        ...(valueChanged ? { value_changed: true } : {}),
      });
    }
  }
  if (exAdded.length) changes.example_added = exAdded;
  if (exRemoved.length) changes.example_removed = exRemoved;
  if (exModified.length) changes.example_modified = exModified;

  // Tags (set)
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'dto', slug, op: 'noop' };
  return { type: 'dto', slug, op: 'modified', changes };
}

/**
 * 0.2.23 — `dto` computes NOTHING.
 *
 * It kept two views until now: `inline_mention`, because `label`/`href` were a
 * rendering decision rather than fields, and `detail`, because it JOINED — the
 * endpoints referencing this DTO and the page sections mentioning it, neither of
 * which lives in `dto`'s own row.
 *
 * Both are gone. The chip's label is the reserved `title` and its `href` is
 * derived by the host from the manifest's `pathPrefix`, so the first view was
 * reproducing what the projection now produces for every type alike. The joins
 * went with it: `_references` because the page-scanning `find_references` (M19)
 * answers that question directly, and `endpoints` because the spec keeps the
 * endpoint↔DTO edge once, on the endpoint side, and describes no read surface
 * for the reverse direction. A patch is filed for the latter — the DTO detail
 * panel's "Used by endpoints" list has no specified operation behind it.
 */
/**
 * 0.2.24 — spread onto the type. The `serializer` wrapper is rejected now, and
 * `payloadVersion` is not echoed here: the manifest in `index.ts` declares it,
 * and it was always the only copy anything read.
 */
export const dtoSerialization = {
  payloadUpgrades: dtoPayloadUpgrades,
  diff: dtoDiff,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades' | 'diff'>;
