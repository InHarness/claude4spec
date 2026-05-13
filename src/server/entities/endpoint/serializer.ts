import type { RawEntity, SectionEntityRef } from '../../domain/raw-entity-reader.js';
import type {
  EntityDiff,
  EntitySerializer,
  RestoreContext,
  RestoreResult,
  SerializeContext,
} from '../../serialization/types.js';
import type { EndpointDtoRelation, HttpMethod } from '../../../shared/entities.js';

interface EndpointDtoRef {
  dtoSlug: string;
  dtoName: string;
  relation: string;
  statusCode: number | null;
}

function label(entity: RawEntity): string {
  const method = (entity.data.method as string | undefined) ?? '';
  const path = (entity.data.path as string | undefined) ?? '';
  return `${method} ${path}`.trim();
}

function href(entity: RawEntity): string {
  return `/endpoints/${entity.slug}`;
}

function baseSingle(entity: RawEntity, ctx: SerializeContext, includeDtos = true) {
  const dtos = includeDtos ? ctx.reader.findEndpointDtos(entity.id) : undefined;
  return {
    type: 'endpoint',
    slug: entity.slug,
    method: entity.data.method as string,
    path: entity.data.path as string,
    summary: (entity.data.summary as string) ?? '',
    description: (entity.data.description as string | null) ?? null,
    tags: entity.tags,
    ...(dtos !== undefined ? { dtos: formatDtos(dtos) } : {}),
  };
}

function formatDtos(dtos: EndpointDtoRef[]) {
  return dtos.map((d) => ({
    dtoSlug: d.dtoSlug,
    dtoName: d.dtoName,
    relation: d.relation,
    statusCode: d.statusCode,
  }));
}

// ─── M17 Snapshot shape (entities/endpoint.md `ensn0sho`) ───────────────────

export interface EndpointSnapshot {
  slug: string;
  method: HttpMethod;
  path: string;
  summary: string | null;
  description: string | null;
  linked_dtos: Array<{
    dto_slug: string;
    relation: EndpointDtoRelation;
    status_code: number | null;
  }>;
  tags: string[];
}

function buildSnapshot(entity: RawEntity, ctx: SerializeContext): EndpointSnapshot {
  const dtos = ctx.reader.findEndpointDtos(entity.id);
  return {
    slug: entity.slug,
    method: entity.data.method as HttpMethod,
    path: entity.data.path as string,
    summary: ((entity.data.summary as string) ?? '') || null,
    description: (entity.data.description as string | null) ?? null,
    linked_dtos: dtos
      .map((d) => ({
        dto_slug: d.dtoSlug,
        relation: d.relation as EndpointDtoRelation,
        status_code: d.statusCode,
      }))
      .sort((a, b) => `${a.relation}:${a.dto_slug}:${a.status_code ?? ''}`.localeCompare(
        `${b.relation}:${b.dto_slug}:${b.status_code ?? ''}`
      )),
    tags: [...entity.tags].sort(),
  };
}

/** Defensive coercion of pre-M17 legacy rows (Endpoint domain object) to the
 *  EndpointSnapshot shape. Post-M17 rows already match the shape. */
function coerceEndpoint(raw: unknown): EndpointSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  // Legacy: { dtos: [{ dtoSlug, relation, statusCode }] } → linked_dtos
  let linked_dtos = r.linked_dtos as EndpointSnapshot['linked_dtos'] | undefined;
  if (!linked_dtos && Array.isArray(r.dtos)) {
    linked_dtos = (r.dtos as Array<Record<string, unknown>>).map((d) => ({
      dto_slug: String(d.dtoSlug ?? d.dto_slug ?? ''),
      relation: String(d.relation ?? '') as EndpointSnapshot['linked_dtos'][number]['relation'],
      status_code: (d.statusCode ?? d.status_code ?? null) as number | null,
    }));
  }
  return {
    slug: String(r.slug ?? ''),
    method: String(r.method ?? '') as EndpointSnapshot['method'],
    path: String(r.path ?? ''),
    summary: (r.summary as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    linked_dtos: linked_dtos ?? [],
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function endpointDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'endpoint', slug, op: 'noop' };
  if (a == null) return { type: 'endpoint', slug, op: 'created' };
  if (b == null) return { type: 'endpoint', slug, op: 'deleted' };
  const sa = coerceEndpoint(a);
  const sb = coerceEndpoint(b);

  const changes: Record<string, unknown> = {};
  const fieldChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const field of ['method', 'path', 'summary', 'description'] as const) {
    if (sa[field] !== sb[field]) fieldChanges.push({ field, from: sa[field], to: sb[field] });
  }
  if (fieldChanges.length) changes.field_changes = fieldChanges;

  // Junction diff by (relation, dto_slug)
  const keyOf = (l: EndpointSnapshot['linked_dtos'][number]) => `${l.relation}|${l.dto_slug}`;
  const aMap = new Map(sa.linked_dtos.map((l) => [keyOf(l), l]));
  const bMap = new Map(sb.linked_dtos.map((l) => [keyOf(l), l]));
  const dtoAdded: typeof sa.linked_dtos = [];
  const dtoRemoved: typeof sa.linked_dtos = [];
  const statusChanged: Array<{ dto_slug: string; relation: string; from: number | null; to: number | null }> = [];
  for (const [k, link] of bMap) {
    if (!aMap.has(k)) dtoAdded.push(link);
  }
  for (const [k, link] of aMap) {
    const other = bMap.get(k);
    if (!other) {
      dtoRemoved.push(link);
    } else if (other.status_code !== link.status_code) {
      statusChanged.push({
        dto_slug: link.dto_slug,
        relation: link.relation,
        from: link.status_code,
        to: other.status_code,
      });
    }
  }
  if (dtoAdded.length) changes.dto_added = dtoAdded;
  if (dtoRemoved.length) changes.dto_removed = dtoRemoved;
  if (statusChanged.length) changes.status_code_changed = statusChanged;

  // Tag diff (set semantics)
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'endpoint', slug, op: 'noop' };
  return { type: 'endpoint', slug, op: 'modified', changes };
}

function endpointRestore(data: unknown, ctx: RestoreContext): RestoreResult {
  const snap = data as EndpointSnapshot;
  const upsertResult = ctx.writer.upsertEndpoint(
    snap.slug,
    {
      method: snap.method,
      path: snap.path,
      summary: snap.summary ?? '',
      description: snap.description ?? undefined,
    },
    ctx.actor
  );
  // Sync tags + junction (idempotent)
  ctx.writer.syncTags('endpoint', snap.slug, snap.tags);
  const junctionResult = ctx.writer.syncEndpointDtos(
    snap.slug,
    snap.linked_dtos.map((l) => ({
      dtoSlug: l.dto_slug,
      relation: l.relation,
      statusCode: l.status_code,
    }))
  );

  const warnings = junctionResult.warnings.length ? junctionResult.warnings : undefined;
  return {
    op: upsertResult.op,
    entity: upsertResult.entity,
    ...(warnings ? { warnings } : {}),
  };
}

export const endpointSerializer: EntitySerializer<RawEntity> = {
  type: 'endpoint',
  version: '1.0.0',

  inlineMention: (entity) => ({
    type: 'endpoint',
    slug: entity.slug,
    label: label(entity),
    href: href(entity),
  }),

  singleElement: (entity, ctx) => baseSingle(entity, ctx, true),

  elementListItem: (entity, ctx) => {
    const base = baseSingle(entity, ctx, true);
    const description = base.description ? base.description.split('\n')[0] : null;
    return { ...base, description };
  },

  taggedListItem: (entity, ctx) => {
    const base = baseSingle(entity, ctx, true);
    const description = base.description ? base.description.split('\n')[0] : null;
    return { ...base, description };
  },

  detail: (entity, ctx) => {
    const base = baseSingle(entity, ctx, true);
    const brokenRefs: string[] = [];
    const dtos = ctx.reader.findEndpointDtos(entity.id);
    const dtoObjects = dtos.map((link) => {
      const dto = ctx.reader.getEntity('dto', link.dtoSlug);
      if (!dto) {
        brokenRefs.push(`dto:${link.dtoSlug}`);
        return { ...link, dto: null };
      }
      if (ctx.depth >= ctx.maxDepth) {
        return { ...link, dto: { slug: dto.slug, name: dto.data.name as string, _truncated: true } };
      }
      return {
        ...link,
        dto: {
          slug: dto.slug,
          name: dto.data.name as string,
          description: (dto.data.description as string | null) ?? null,
          fields: dto.data.fields,
          tags: dto.tags,
        },
      };
    });

    const references = ctx.reader.findSectionReferences('endpoint', entity.id);
    return {
      ...base,
      dtos: dtoObjects,
      _references: formatReferences(references),
      ...(brokenRefs.length ? { _brokenRefs: brokenRefs } : {}),
    };
  },

  // ─── M17 ───
  snapshot: (entity, ctx) => buildSnapshot(entity, ctx),
  restore: endpointRestore,
  diff: endpointDiff,
};

function formatReferences(refs: SectionEntityRef[]) {
  return refs.map((r) => ({
    anchor: r.anchor,
    pagePath: r.pagePath,
    headingText: r.headingText,
    relation: r.relation,
  }));
}
