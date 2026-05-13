import type { RawEntity } from '../../domain/raw-entity-reader.js';
import type {
  EntityDiff,
  EntitySerializer,
  RestoreContext,
  RestoreResult,
  SerializeContext,
} from '../../serialization/types.js';
import type { AcKind, AcStatus, AcVerifyRef } from '../../../shared/entities.js';

function baseSingle(entity: RawEntity) {
  return {
    type: 'ac',
    slug: entity.slug,
    text: (entity.data.text as string) ?? '',
    kind: ((entity.data.kind as AcKind) ?? 'requirement') as AcKind,
    status: ((entity.data.status as AcStatus) ?? 'active') as AcStatus,
    verifies: ((entity.data.verifies as AcVerifyRef[] | undefined) ?? []),
    description: (entity.data.description as string | null) ?? null,
    tags: entity.tags,
  };
}

// ─── M17 Snapshot shape ─────────────────────────────────────────────────────

export interface AcSnapshot {
  slug: string;
  text: string;
  kind: AcKind;
  status: AcStatus;
  verifies: AcVerifyRef[];
  description: string | null;
  tags: string[];
}

function buildSnapshot(entity: RawEntity): AcSnapshot {
  const verifies = ((entity.data.verifies as AcVerifyRef[] | undefined) ?? [])
    .filter((v) => v && typeof v.type === 'string' && typeof v.slug === 'string')
    .map((v) => ({ type: v.type, slug: v.slug }))
    .sort((a, b) => `${a.type}/${a.slug}`.localeCompare(`${b.type}/${b.slug}`));
  return {
    slug: entity.slug,
    text: (entity.data.text as string) ?? '',
    kind: ((entity.data.kind as AcKind) ?? 'requirement') as AcKind,
    status: ((entity.data.status as AcStatus) ?? 'active') as AcStatus,
    verifies,
    description: (entity.data.description as string | null) ?? null,
    tags: [...entity.tags].sort(),
  };
}

function coerceAc(raw: unknown): AcSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  const verifies = Array.isArray(r.verifies)
    ? (r.verifies as AcVerifyRef[]).filter((v) => v && typeof v.type === 'string' && typeof v.slug === 'string')
    : [];
  return {
    slug: String(r.slug ?? ''),
    text: String(r.text ?? ''),
    kind: ((r.kind as AcKind) ?? 'requirement') as AcKind,
    status: ((r.status as AcStatus) ?? 'active') as AcStatus,
    verifies,
    description: (r.description as string | null) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function acDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'ac', slug, op: 'noop' };
  if (a == null) return { type: 'ac', slug, op: 'created' };
  if (b == null) return { type: 'ac', slug, op: 'deleted' };
  const sa = coerceAc(a);
  const sb = coerceAc(b);
  const changes: Record<string, unknown> = {};

  if (sa.text !== sb.text) changes.text_changed = { from: sa.text, to: sb.text };
  if (sa.kind !== sb.kind) changes.kind_changed = { from: sa.kind, to: sb.kind };
  if (sa.status !== sb.status) changes.status_changed = { from: sa.status, to: sb.status };
  if (sa.description !== sb.description) {
    changes.description_changed = { from: sa.description, to: sb.description };
  }

  const verifyKey = (v: AcVerifyRef) => `${v.type}/${v.slug}`;
  const aVerify = new Set(sa.verifies.map(verifyKey));
  const bVerify = new Set(sb.verifies.map(verifyKey));
  const verifyAdded = sb.verifies.filter((v) => !aVerify.has(verifyKey(v)));
  const verifyRemoved = sa.verifies.filter((v) => !bVerify.has(verifyKey(v)));
  if (verifyAdded.length) changes.verify_added = verifyAdded;
  if (verifyRemoved.length) changes.verify_removed = verifyRemoved;

  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'ac', slug, op: 'noop' };
  return { type: 'ac', slug, op: 'modified', changes };
}

function acRestore(data: unknown, ctx: RestoreContext): RestoreResult {
  const snap = data as AcSnapshot;
  const result = ctx.writer.upsertAc(
    snap.slug,
    {
      text: snap.text,
      kind: snap.kind,
      status: snap.status,
      verifies: snap.verifies,
      description: snap.description,
      slug: snap.slug,
    },
    ctx.actor,
  );
  ctx.writer.syncTags('ac', snap.slug, snap.tags);
  return { op: result.op, entity: result.entity };
}

export const acSerializer: EntitySerializer<RawEntity> = {
  type: 'ac',
  version: '1.0.0',

  inlineMention: (entity) => ({
    type: 'ac',
    slug: entity.slug,
    label: (entity.data.text as string) ?? entity.slug,
    href: `/acs/${entity.slug}`,
  }),

  singleElement: (entity) => baseSingle(entity),

  elementListItem: (entity) => baseSingle(entity),

  taggedListItem: (entity) => baseSingle(entity),

  detail: (entity, ctx: SerializeContext) => {
    const base = baseSingle(entity);
    const references = ctx.reader.findSectionReferences('ac', entity.id).map((r) => ({
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
  restore: acRestore,
  diff: acDiff,
};
