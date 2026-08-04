import type { RawEntity } from '../../discovery/raw-entity-reader.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializationContribution,
} from '../../serialization/types.js';
import type { DiagramFormat } from '../../../shared/entities.js';

// ─── snapshot shape (committed file format) ─────────────────────────────────

export interface DiagramSnapshot {
  slug: string;
  format: DiagramFormat;
  /** Literal DSL body, kept verbatim (no trim). May be empty. */
  source: string;
  tags: string[];
}

function readFormat(value: unknown): DiagramFormat {
  return value === 'd2' ? 'd2' : 'mermaid';
}

function readSource(value: unknown): string {
  // `source` is stored verbatim; coerce defensively (a JSON-shaped source could
  // be hydrated into a non-string by the generic reader — mermaid DSL never is).
  return typeof value === 'string' ? value : '';
}

// ─── view helpers ────────────────────────────────────────────────────────────

function baseSingle(entity: RawEntity) {
  return {
    type: 'diagram',
    slug: entity.slug,
    format: readFormat(entity.data.format),
    source: readSource(entity.data.source),
    tags: entity.tags,
  };
}

function trimItem(entity: RawEntity) {
  const source = readSource(entity.data.source);
  return {
    type: 'diagram',
    slug: entity.slug,
    format: readFormat(entity.data.format),
    sourceLines: source ? source.split('\n').length : 0,
    tags: entity.tags,
  };
}

// ─── snapshot / restore / diff ──────────────────────────────────────────────

function buildSnapshot(entity: RawEntity): DiagramSnapshot {
  return {
    slug: entity.slug,
    format: readFormat(entity.data.format),
    source: readSource(entity.data.source),
    tags: [...entity.tags].sort(),
  };
}

function coerce(raw: unknown): DiagramSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: String(r.slug ?? ''),
    format: readFormat(r.format),
    source: readSource(r.source),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function diagramRestore(data: unknown, ctx: RestoreContext): RestoreResult {
  const snap = coerce(data);
  const result = ctx.writer.upsert('diagram',
    snap.slug,
    { slug: snap.slug, format: snap.format, source: snap.source },
    ctx.actor
  );
  if (!result) {
    // 0.2.2: no registered service for this type in this project — report the
    // skip, do not throw. A deactivated type must not abort a whole restore.
    return { op: 'noop', entity: null, warnings: [`entity service for type 'diagram' is not available — restore skipped`] };
  }
  ctx.writer.syncTags('diagram', snap.slug, snap.tags);
  return {
    op: result.op,
    entity: result.entity,
    ...(result.warnings && result.warnings.length ? { warnings: result.warnings } : {}),
  };
}

function diagramDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'diagram', slug, op: 'noop' };
  if (a == null) return { type: 'diagram', slug, op: 'created' };
  if (b == null) return { type: 'diagram', slug, op: 'deleted' };
  const sa = coerce(a);
  const sb = coerce(b);
  const changes: Record<string, unknown> = {};

  if (sa.format !== sb.format) changes.format_changed = { from: sa.format, to: sb.format };
  if (sa.source !== sb.source) changes.source_changed = true;

  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'diagram', slug, op: 'noop' };
  return { type: 'diagram', slug, op: 'modified', changes };
}

export const diagramSerializer: SerializationContribution<RawEntity> = {
  payloadVersion: 1,

  views: {
    inline_mention: (entity) => ({
      type: 'diagram',
      slug: entity.slug,
      label: entity.slug,
      href: `/diagrams/${entity.slug}`,
    }),

    single_element: (entity) => baseSingle(entity),
    element_list_item: (entity) => trimItem(entity),
    tagged_list_item: (entity) => trimItem(entity),

    detail: (entity, reader) => {
      const base = baseSingle(entity);
      const references = reader.findSectionReferences('diagram', entity.slug).map((r) => ({
        anchor: r.anchor,
        pagePath: r.pagePath,
        headingText: r.headingText,
        relation: r.relation,
      }));
      return { ...base, _references: references };
    },
  },

  snapshot: (entity) => buildSnapshot(entity),
  restore: diagramRestore,
  diff: diagramDiff,
};
