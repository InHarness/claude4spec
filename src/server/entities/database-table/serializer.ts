import type { RawEntity } from '../../domain/raw-entity-reader.js';
import type {
  EntityDiff,
  EntitySerializer,
  RestoreContext,
  RestoreResult,
  SerializeContext,
} from '../../serialization/types.js';
import type {
  DatabaseTableColumn,
  DatabaseTableIndex,
} from '../../../shared/entities.js';

function baseSingle(entity: RawEntity) {
  return {
    type: 'database-table',
    slug: entity.slug,
    name: entity.data.name as string,
    description: (entity.data.description as string | null) ?? null,
    columns: entity.data.columns ?? [],
    indexes: entity.data.indexes ?? [],
    tags: entity.tags,
  };
}

// ─── M17 Snapshot shape (entities/database-table.md `dbsn0sho`) ─────────────

export interface DatabaseTableSnapshot {
  slug: string;
  name: string;
  description: string | null;
  columns: DatabaseTableColumn[];
  indexes: DatabaseTableIndex[];
  tags: string[];
}

function buildSnapshot(entity: RawEntity): DatabaseTableSnapshot {
  return {
    slug: entity.slug,
    name: entity.data.name as string,
    description: (entity.data.description as string | null) ?? null,
    columns: ((entity.data.columns as DatabaseTableColumn[] | undefined) ?? []),
    indexes: ((entity.data.indexes as DatabaseTableIndex[] | undefined) ?? []),
    tags: [...entity.tags].sort(),
  };
}

function indexKey(idx: DatabaseTableIndex): string {
  if (idx.name) return `name:${idx.name}`;
  return `unnamed:${[...idx.columns].sort().join(',')}|${idx.unique ? 1 : 0}`;
}

function coerceDbTable(raw: unknown): DatabaseTableSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: String(r.slug ?? ''),
    name: String(r.name ?? ''),
    description: (r.description as string | null) ?? null,
    columns: Array.isArray(r.columns) ? (r.columns as DatabaseTableColumn[]) : [],
    indexes: Array.isArray(r.indexes) ? (r.indexes as DatabaseTableIndex[]) : [],
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function dbTableDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'database-table', slug, op: 'noop' };
  if (a == null) return { type: 'database-table', slug, op: 'created' };
  if (b == null) return { type: 'database-table', slug, op: 'deleted' };
  const sa = coerceDbTable(a);
  const sb = coerceDbTable(b);
  const changes: Record<string, unknown> = {};

  // Meta
  const metaChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  if (sa.name !== sb.name) metaChanges.push({ field: 'name', from: sa.name, to: sb.name });
  if (sa.description !== sb.description) metaChanges.push({ field: 'description', from: sa.description, to: sb.description });
  if (metaChanges.length) changes.meta_changes = metaChanges;

  // Columns by name (set semantics; reorder = noop)
  const aCols = new Map(sa.columns.map((c) => [c.name, c]));
  const bCols = new Map(sb.columns.map((c) => [c.name, c]));
  const colAdded: Array<{ name: string; type: string; pk: boolean }> = [];
  const colRemoved: Array<{ name: string; type: string; pk: boolean }> = [];
  const colModified: Array<Record<string, unknown>> = [];
  for (const [name, c] of bCols) {
    if (!aCols.has(name)) colAdded.push({ name, type: c.type, pk: !!c.pk });
  }
  for (const [name, c] of aCols) {
    const other = bCols.get(name);
    if (!other) {
      colRemoved.push({ name, type: c.type, pk: !!c.pk });
      continue;
    }
    const cc: Record<string, unknown> = { name };
    if (c.type !== other.type) cc.type_changed = { from: c.type, to: other.type };
    if (!!c.nullable !== !!other.nullable) cc.nullable_changed = { from: !!c.nullable, to: !!other.nullable };
    if (!!c.unique !== !!other.unique) cc.unique_changed = { from: !!c.unique, to: !!other.unique };
    if (!!c.pk !== !!other.pk) cc.pk_changed = { from: !!c.pk, to: !!other.pk };
    if (JSON.stringify(c.fk ?? null) !== JSON.stringify(other.fk ?? null)) {
      cc.fk_changed = { from: c.fk ?? null, to: other.fk ?? null };
    }
    if ((c.default ?? null) !== (other.default ?? null)) cc.default_changed = { from: c.default ?? null, to: other.default ?? null };
    if (JSON.stringify(c.enumValues ?? null) !== JSON.stringify(other.enumValues ?? null)) {
      cc.enumValues_changed = { from: c.enumValues ?? null, to: other.enumValues ?? null };
    }
    if (Object.keys(cc).length > 1) colModified.push(cc);
  }
  if (colAdded.length) changes.column_added = colAdded;
  if (colRemoved.length) changes.column_removed = colRemoved;
  if (colModified.length) changes.column_modified = colModified;

  // Indexes (by name when named, else by sorted columns + unique)
  const aIdx = new Map(sa.indexes.map((i) => [indexKey(i), i]));
  const bIdx = new Map(sb.indexes.map((i) => [indexKey(i), i]));
  const idxAdded: DatabaseTableIndex[] = [];
  const idxRemoved: DatabaseTableIndex[] = [];
  const idxModified: Array<Record<string, unknown>> = [];
  for (const [k, i] of bIdx) if (!aIdx.has(k)) idxAdded.push(i);
  for (const [k, i] of aIdx) {
    const other = bIdx.get(k);
    if (!other) { idxRemoved.push(i); continue; }
    const im: Record<string, unknown> = { name: i.name ?? null };
    const colChanged = JSON.stringify([...i.columns].sort()) !== JSON.stringify([...other.columns].sort());
    const uniqueChanged = !!i.unique !== !!other.unique;
    if (colChanged) im.columns_changed = { from: i.columns, to: other.columns };
    if (uniqueChanged) im.unique_changed = { from: !!i.unique, to: !!other.unique };
    if (Object.keys(im).length > 1) idxModified.push(im);
  }
  if (idxAdded.length) changes.index_added = idxAdded;
  if (idxRemoved.length) changes.index_removed = idxRemoved;
  if (idxModified.length) changes.index_modified = idxModified;

  // Tags
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'database-table', slug, op: 'noop' };
  return { type: 'database-table', slug, op: 'modified', changes };
}

function dbTableRestore(data: unknown, ctx: RestoreContext): RestoreResult {
  const snap = data as DatabaseTableSnapshot;
  const result = ctx.writer.upsertDatabaseTable(
    snap.slug,
    {
      name: snap.name,
      description: snap.description ?? undefined,
      columns: snap.columns,
      indexes: snap.indexes,
      slug: snap.slug,
    },
    ctx.actor
  );
  ctx.writer.syncTags('database-table', snap.slug, snap.tags);
  return {
    op: result.op,
    entity: result.entity,
    ...(result.warnings && result.warnings.length ? { warnings: result.warnings } : {}),
  };
}

export const databaseTableSerializer: EntitySerializer<RawEntity> = {
  type: 'database-table',
  version: '1.0.0',

  inlineMention: (entity) => ({
    type: 'database-table',
    slug: entity.slug,
    label: (entity.data.name as string) ?? entity.slug,
    href: `/database-tables/${entity.slug}`,
  }),

  singleElement: (entity) => baseSingle(entity),

  elementListItem: (entity) => {
    const { indexes: _indexes, ...trim } = baseSingle(entity);
    return trim;
  },

  taggedListItem: (entity) => {
    const { indexes: _indexes, ...trim } = baseSingle(entity);
    return trim;
  },

  detail: (entity, ctx: SerializeContext) => {
    const base = baseSingle(entity);
    const references = ctx.reader.findSectionReferences('database-table', entity.slug).map((r) => ({
      anchor: r.anchor,
      pagePath: r.pagePath,
      headingText: r.headingText,
      relation: r.relation,
    }));
    return {
      ...base,
      _references: references,
    };
  },

  // ─── M17 ───
  snapshot: (entity) => buildSnapshot(entity),
  restore: dbTableRestore,
  diff: dbTableDiff,
};
