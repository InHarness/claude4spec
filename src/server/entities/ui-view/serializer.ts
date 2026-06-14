import type { RawEntity } from '../../domain/raw-entity-reader.js';
import type {
  EntityDiff,
  EntitySerializer,
  JsonSchema,
  RestoreContext,
  RestoreResult,
  SerializeContext,
  ViewKind,
} from '../../serialization/types.js';
import type { UiViewParam, UiViewParamLocation } from '../../../shared/entities.js';

interface ParamShape {
  name: string;
  in: string;
  type?: string;
  required?: boolean;
  default?: string;
  description?: string;
}

function readParams(entity: RawEntity): ParamShape[] {
  const raw = entity.data.params;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p) => ({
      name: String(p.name ?? ''),
      in: String(p.in ?? ''),
      ...(typeof p.type === 'string' ? { type: p.type } : {}),
      ...(typeof p.required === 'boolean' ? { required: p.required } : {}),
      ...(typeof p.default === 'string' ? { default: p.default } : {}),
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
    }));
}

function readDesignSystemSlug(entity: RawEntity): string | null {
  const raw = entity.data.design_system_slug ?? entity.data.designSystemSlug;
  return typeof raw === 'string' && raw ? raw : null;
}

function baseSingle(entity: RawEntity) {
  return {
    type: 'ui-view',
    slug: entity.slug,
    name: (entity.data.name as string) ?? entity.slug,
    url: (entity.data.url as string | null) ?? null,
    description: (entity.data.description as string | null) ?? null,
    params: readParams(entity),
    designSystemSlug: readDesignSystemSlug(entity),
    tags: entity.tags,
  };
}

function trimItem(entity: RawEntity) {
  const params = readParams(entity);
  return {
    type: 'ui-view',
    slug: entity.slug,
    name: (entity.data.name as string) ?? entity.slug,
    url: (entity.data.url as string | null) ?? null,
    description: (entity.data.description as string | null) ?? null,
    paramCount: params.length,
    tags: entity.tags,
  };
}

const PARAM_OBJECT_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['name', 'in'],
  properties: {
    name: { type: 'string' },
    in: { type: 'string', enum: ['path', 'query', 'hash'] },
    type: { type: 'string' },
    required: { type: 'boolean' },
    default: { type: 'string' },
    description: { type: 'string' },
  },
  additionalProperties: false,
};

const SINGLE_ELEMENT_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['type', 'slug', 'name', 'params', 'tags'],
  properties: {
    type: { const: 'ui-view' },
    slug: { type: 'string' },
    name: { type: 'string' },
    url: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    params: { type: 'array', items: PARAM_OBJECT_SCHEMA },
    designSystemSlug: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

// ─── M17 Snapshot shape (entities/ui-view.md `uvsn0sho`) ────────────────────

export interface UiViewSnapshot {
  slug: string;
  name: string;
  url: string | null;
  description: string | null;
  params: UiViewParam[];
  /** v0.1.59 (serializer 1.1.0, additive): referenced design-system slug, or null. */
  designSystemSlug: string | null;
  tags: string[];
}

function buildSnapshot(entity: RawEntity): UiViewSnapshot {
  return {
    slug: entity.slug,
    name: (entity.data.name as string) ?? entity.slug,
    url: (entity.data.url as string | null) ?? null,
    description: (entity.data.description as string | null) ?? null,
    params: readParams(entity).map((p) => ({
      name: p.name,
      in: p.in as UiViewParamLocation,
      ...(p.type !== undefined ? { type: p.type } : {}),
      ...(p.required !== undefined ? { required: p.required } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(p.description !== undefined ? { description: p.description } : {}),
    })),
    designSystemSlug: readDesignSystemSlug(entity),
    tags: [...entity.tags].sort(),
  };
}

function coerceUiView(raw: unknown): UiViewSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: String(r.slug ?? ''),
    name: String(r.name ?? ''),
    url: (r.url as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    params: Array.isArray(r.params) ? (r.params as UiViewParam[]) : [],
    designSystemSlug:
      typeof r.designSystemSlug === 'string' && r.designSystemSlug ? r.designSystemSlug : null,
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
  if (sa.name !== sb.name) metaChanges.push({ field: 'name', from: sa.name, to: sb.name });
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

  // Tags
  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'ui-view', slug, op: 'noop' };
  return { type: 'ui-view', slug, op: 'modified', changes };
}

function uiViewRestore(data: unknown, ctx: RestoreContext): RestoreResult {
  const snap = coerceUiView(data);
  const result = ctx.writer.upsertUiView(
    snap.slug,
    {
      name: snap.name,
      url: snap.url,
      description: snap.description ?? undefined,
      params: snap.params,
      // v0.1.59: the value is kept verbatim even if the DS is gone (dangling → warn, never null).
      designSystemSlug: snap.designSystemSlug,
      slug: snap.slug,
    },
    ctx.actor
  );
  ctx.writer.syncTags('ui-view', snap.slug, snap.tags);
  const warnings = [...(result.warnings ?? [])];
  // Dangling design-system reference: warn but keep the field (consistent with
  // "warnings, not errors"). design-system is indexed before ui-view, so a
  // present DS resolves here; absence means the file is gone / type inactive.
  if (snap.designSystemSlug && !ctx.reader.getEntity('design-system', snap.designSystemSlug)) {
    warnings.push(
      `ui-view '${snap.slug}': designSystemSlug '${snap.designSystemSlug}' does not resolve (dangling)`
    );
  }
  return {
    op: result.op,
    entity: result.entity,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const uiViewSerializer: EntitySerializer<RawEntity> = {
  type: 'ui-view',
  // v0.1.59: bumped 1.0.0 → 1.1.0 (additive — designSystemSlug). Forward-compat:
  // future linked_components[] (ui-component entity) will be 1.2.0 (1.1.0 taken).
  version: '1.1.0',

  inlineMention: (entity) => ({
    type: 'ui-view',
    slug: entity.slug,
    label: (entity.data.name as string) ?? entity.slug,
    url: (entity.data.url as string | null) ?? null,
    href: `/ui-views/${entity.slug}`,
  }),

  singleElement: (entity) => baseSingle(entity),

  elementListItem: (entity) => trimItem(entity),

  taggedListItem: (entity) => trimItem(entity),

  detail: (entity, ctx: SerializeContext) => {
    const base = baseSingle(entity);
    const references = ctx.reader.findSectionReferences('ui-view', entity.slug).map((r) => ({
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

  schema: (view: ViewKind): JsonSchema => {
    if (view === 'single_element' || view === 'detail') return SINGLE_ELEMENT_SCHEMA;
    if (view === 'inline_mention') {
      return {
        type: 'object',
        required: ['type', 'slug', 'label', 'href'],
        properties: {
          type: { const: 'ui-view' },
          slug: { type: 'string' },
          label: { type: 'string' },
          url: { type: ['string', 'null'] },
          href: { type: 'string' },
        },
      };
    }
    return {
      type: 'object',
      required: ['type', 'slug', 'name', 'paramCount', 'tags'],
      properties: {
        type: { const: 'ui-view' },
        slug: { type: 'string' },
        name: { type: 'string' },
        url: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        paramCount: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
  },

  // ─── M17 ───
  snapshot: (entity) => buildSnapshot(entity),
  restore: uiViewRestore,
  diff: uiViewDiff,
};

