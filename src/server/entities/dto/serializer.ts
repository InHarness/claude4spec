import type { RawEntity } from '../../domain/raw-entity-reader.js';
import type {
  EntityDiff,
  EntitySerializer,
  RestoreContext,
  RestoreResult,
  SerializeContext,
} from '../../serialization/types.js';
import type { DtoExample, DtoField } from '../../../shared/entities.js';

function baseSingle(entity: RawEntity) {
  return {
    type: 'dto',
    slug: entity.slug,
    name: entity.data.name as string,
    description: (entity.data.description as string | null) ?? null,
    fields: entity.data.fields ?? [],
    examples: entity.data.examples ?? [],
    tags: entity.tags,
  };
}

// ─── M17 Snapshot shape (entities/dto.md `dtosn0sho`) ───────────────────────

export interface DtoSnapshot {
  slug: string;
  name: string;
  description: string | null;
  fields: DtoField[];
  examples: DtoExample[];
  tags: string[];
}

function buildSnapshot(entity: RawEntity): DtoSnapshot {
  return {
    slug: entity.slug,
    name: entity.data.name as string,
    description: (entity.data.description as string | null) ?? null,
    fields: ((entity.data.fields as DtoField[] | undefined) ?? []).map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required,
      ...(f.description !== undefined ? { description: f.description } : {}),
    })),
    examples: ((entity.data.examples as DtoExample[] | undefined) ?? []).map((e) => ({
      name: e.name,
      ...(e.summary !== undefined ? { summary: e.summary } : {}),
      value: e.value,
    })),
    tags: [...entity.tags].sort(),
  };
}

function coerceDto(raw: unknown): DtoSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: String(r.slug ?? ''),
    name: String(r.name ?? ''),
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
  if (sa.name !== sb.name) metaChanges.push({ field: 'name', from: sa.name, to: sb.name });
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

function dtoRestore(data: unknown, ctx: RestoreContext): RestoreResult {
  const snap = data as DtoSnapshot;
  const result = ctx.writer.upsertDto(
    snap.slug,
    {
      name: snap.name,
      description: snap.description ?? undefined,
      fields: snap.fields,
      examples: snap.examples,
      slug: snap.slug,
    },
    ctx.actor
  );
  ctx.writer.syncTags('dto', snap.slug, snap.tags);
  return { op: result.op, entity: result.entity };
}

export const dtoSerializer: EntitySerializer<RawEntity> = {
  type: 'dto',
  version: '1.1.0',

  inlineMention: (entity) => ({
    type: 'dto',
    slug: entity.slug,
    label: (entity.data.name as string) ?? entity.slug,
    href: `/dtos/${entity.slug}`,
  }),

  singleElement: (entity) => baseSingle(entity),

  elementListItem: (entity) => baseSingle(entity),

  taggedListItem: (entity) => baseSingle(entity),

  detail: (entity, ctx: SerializeContext) => {
    const base = baseSingle(entity);
    const endpoints = ctx.reader.findDtoEndpoints(entity.slug).map((e) => ({
      endpointSlug: e.endpointSlug,
      method: e.method,
      path: e.path,
      relation: e.relation,
      statusCode: e.statusCode,
    }));
    const references = ctx.reader.findSectionReferences('dto', entity.slug).map((r) => ({
      anchor: r.anchor,
      pagePath: r.pagePath,
      headingText: r.headingText,
      relation: r.relation,
    }));
    return {
      ...base,
      endpoints,
      _references: references,
    };
  },

  // ─── M17 ───
  snapshot: (entity) => buildSnapshot(entity),
  restore: dtoRestore,
  diff: dtoDiff,
};
