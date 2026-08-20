/**
 * Pure projection functions: `RawDelta` / `SpecSnapshot` (L2) → MCP-friendly
 * self-contained shapes (`MCPReleaseDiff` / `MCPSpecSnapshot`). No I/O,
 * no DB access — caller hands raw inputs in.
 */

import type {
  LineDiffLite,
  PageXmlRefLite,
  RawDelta,
  RawDeltaEntityChange,
  RawDeltaPageChange,
  SpecSnapshot,
  SpecSnapshotEntityRow,
  SpecSnapshotPageRow,
} from '../../../shared/entities.js';
import { parseSections } from '../../services/file-serializer.js';
import {
  applyItemBudget,
  DEFAULT_BUDGET_CHARS,
  fitToBudget,
} from '../../discovery/budget.js';
import type {
  EntitySnapshot,
  EntityTypeFilter,
  MCPEntityDelta,
  MCPEntityDeltaLight,
  MCPPageDelta,
  MCPPageDeltaLight,
  MCPReleaseDiff,
  MCPSectionDelta,
  MCPSpecSnapshot,
  ProjectionOpts,
} from './types.js';

type RawEntityOp = RawDeltaEntityChange['op'];
type RawPageOp = RawDeltaPageChange['op'];
type MCPOp = 'create' | 'update' | 'delete';

/*
 * 0.2.11: the `ENTITY_TYPES` whitelist that stood here is GONE.
 *
 * It was a second hardcoded five, one layer above `ReleaseService`, and it
 * dropped every other type from `release_diff` AFTER the snapshot had captured
 * it — so the brief-authoring agent, the main consumer of these tools, could not
 * see a design system, a diagram or any plugin type no matter what the release
 * contained. It also disagreed with `projectSnapshotEntities` below, which never
 * applied it: `release_get` and `release_diff` answered differently about the
 * same type.
 *
 * Nothing replaces it. `raw.entities` only ever contains types the (now
 * registry-derived) snapshot covered, so the membership test was redundant as
 * well as wrong; the caller's optional `entityTypes` filter is the real one.
 */

/**
 * How much of a degraded section body survives as text.
 *
 * Deliberately far below `DEFAULT_BUDGET_CHARS`: this slice is what a section
 * gets once the response has ALREADY run out of room, so sizing it at the whole
 * budget would defeat the cut it exists to implement. It is big enough to show
 * what kind of change the section carries — the first hunks, with their
 * `<before_change>` / `<after_change>` tags intact — and small enough that a
 * page full of them still leaves the envelope answerable.
 */
const DEGRADED_SECTION_CHARS = 2_000;

const HEAVY_RETRY_HINT =
  'response budget exceeded — items past the cut kept their identity and lost their payload (`truncated: true`). ' +
  'Retry narrower: pass `entityTypes` to restrict the entity dimension, lower `limit`, advance `offset` to reach ' +
  'the items that degraded, or call again with `summaryOnly: true` for the identity map of the whole delta.';

/**
 * Project a raw delta, applying the response budget on the way out.
 *
 * The budget is spent across BOTH dimensions in order (entities, then pages),
 * not halved between them: the caller paid for one response, and a fixed split
 * would degrade a small pages dimension to make room for entities that never
 * arrived. Each dimension keeps its own first item whole, which is a superset
 * of the "first item of the response never degrades" guarantee.
 */
export function projectReleaseDiff(
  raw: RawDelta,
  fromSnap: SpecSnapshot | null,
  toSnap: SpecSnapshot,
  opts: ProjectionOpts,
  options?: { summaryOnly?: boolean; limit?: number; offset?: number },
): MCPReleaseDiff {
  const summaryOnly = options?.summaryOnly ?? false;
  const limit = options?.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = options?.offset ?? 0;
  const out: MCPReleaseDiff = { from: raw.from, to: raw.to, total: {} };
  const hints: string[] = [];
  let spent = 0;
  const remaining = (): number => Math.max(DEFAULT_BUDGET_CHARS - spent, 0);
  const charge = (value: unknown): void => {
    spent += JSON.stringify(value)?.length ?? 0;
  };

  // Compute the FULL filtered delta first, record `total` on it, THEN branch:
  // light (`summaryOnly`) strips to identifiers; heavy slices
  // `entities[]`/`pages[]` independently by the same `limit`/`offset`.
  if (opts.include.includes('entities')) {
    const full = projectEntities(raw.entities, fromSnap, toSnap, opts.entityTypes);
    out.total!.entities = full.length;
    if (summaryOnly) {
      const light = full.map(toEntityLight);
      const { items, hint } = budgetLightMap(light, offset, remaining(), 'entities');
      out.entities = items;
      if (hint) hints.push(hint);
    } else {
      const budgeted = applyItemBudget(
        full.slice(offset, offset + limit),
        degradeEntity,
        HEAVY_RETRY_HINT,
        remaining(),
      );
      out.entities = budgeted.items;
      if (budgeted.truncated) hints.push(HEAVY_RETRY_HINT);
    }
    charge(out.entities);
  }
  if (opts.include.includes('pages')) {
    const full = projectPages(raw.pages, fromSnap, toSnap);
    out.total!.pages = full.length;
    if (summaryOnly) {
      const light = full.map(toPageLight);
      const { items, hint } = budgetLightMap(light, offset, remaining(), 'pages');
      out.pages = items;
      if (hint) hints.push(hint);
    } else {
      const budgeted = applyItemBudget(
        full.slice(offset, offset + limit),
        degradePage,
        HEAVY_RETRY_HINT,
        remaining(),
      );
      out.pages = budgeted.items;
      if (budgeted.truncated) hints.push(HEAVY_RETRY_HINT);
    }
    charge(out.pages);
  }
  if (hints.length > 0) out.truncationHint = [...new Set(hints)].join(' ');
  return out;
}

/**
 * The guaranteed floor. `summaryOnly` still answers with the WHOLE map — that
 * is the contract the brief-author probe stands on, and `limit` is still
 * ignored here — but a map big enough to bust the budget now PAGES instead of
 * being handed over oversized.
 *
 * `offset` is honoured (and only here does it mean anything in light mode)
 * because it is the cursor the hint points at: an instruction to resume from an
 * offset the operation ignores would be unfollowable. Rows are never
 * impoverished, only postponed — a light row is already nothing but identity
 * and `op`, so there is no half of it left to drop.
 */
function budgetLightMap<T>(
  all: readonly T[],
  offset: number,
  budgetChars: number,
  dimension: 'entities' | 'pages',
): { items: T[]; hint?: string } {
  const window = all.slice(offset);
  const items = fitToBudget(window, budgetChars);
  if (items.length === window.length) return { items };
  return {
    items,
    hint:
      `the ${dimension} identity map does not fit in one response — ` +
      `continue with \`offset: ${offset + items.length}\` (\`total\` reports the full count). No row was dropped, only postponed.`,
  };
}

/**
 * An entity past the budget loses `before`/`after` WHOLE.
 *
 * Not shortened: an entity snapshot is a serialized record whose shape is the
 * information, and half of one is malformed data wearing the shape of a record.
 * A consumer parsing it would not get less — it would get something wrong.
 */
function degradeEntity(e: MCPEntityDelta): MCPEntityDelta {
  const { before: _before, after: _after, ...identity } = e;
  return { ...identity, truncated: true };
}

/**
 * A page past the budget keeps every section and every `content`, cut as TEXT.
 *
 * The opposite choice to `degradeEntity`, and for the opposite reason: a section
 * body is prose with inline diff tags, and a prefix of it is still prose with
 * inline diff tags — the same kind of data, less of it. A `moved` section has no
 * `content` to cut and is left exactly as it is.
 */
function degradePage(p: MCPPageDelta): MCPPageDelta {
  return {
    ...p,
    sections: p.sections.map((section) => {
      if (section.content === undefined || section.content.length <= DEGRADED_SECTION_CHARS) {
        return section;
      }
      return {
        ...section,
        content: section.content.slice(0, DEGRADED_SECTION_CHARS),
        truncated: true,
      };
    }),
  };
}

/** Strip a heavy entity delta to its light identifier form (`summaryOnly: true`). */
function toEntityLight(e: MCPEntityDelta): MCPEntityDeltaLight {
  return { type: e.type, slug: e.slug, name: e.name, op: e.op };
}

/** Strip a heavy page delta to its light identifier form (`summaryOnly: true`). */
function toPageLight(p: MCPPageDelta): MCPPageDeltaLight {
  return { path: p.path, op: p.op };
}

function projectEntities(
  rawEntities: RawDeltaEntityChange[],
  fromSnap: SpecSnapshot | null,
  toSnap: SpecSnapshot,
  entityTypes: EntityTypeFilter[] | undefined,
): MCPEntityDelta[] {
  const fromMap = indexEntitiesByTypeSlug(fromSnap?.entities ?? []);
  const toMap = indexEntitiesByTypeSlug(toSnap.entities);
  const out: MCPEntityDelta[] = [];

  for (const e of rawEntities) {
    if (e.op === 'noop') continue;
    if (entityTypes && !entityTypes.includes(e.type as EntityTypeFilter)) continue;

    const op = mapEntityOp(e.op);
    if (!op) continue;

    const key = `${e.type}|${e.slug}`;
    const before = op === 'create' ? undefined : (fromMap.get(key)?.data as EntitySnapshot | undefined);
    const after = op === 'delete' ? undefined : (toMap.get(key)?.data as EntitySnapshot | undefined);

    out.push({
      type: e.type as MCPEntityDelta['type'],
      slug: e.slug,
      name: extractEntityName(after ?? before, e.slug),
      op,
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
    });
  }
  return out;
}

function projectPages(
  rawPages: RawDeltaPageChange[],
  fromSnap: SpecSnapshot | null,
  toSnap: SpecSnapshot,
): MCPPageDelta[] {
  const fromPagesMap = indexPagesByPath(fromSnap?.pages ?? []);
  const toPagesMap = indexPagesByPath(toSnap.pages);
  const out: MCPPageDelta[] = [];

  for (const p of rawPages) {
    if (p.op === 'noop') continue;
    const op = mapPageOp(p.op);
    if (!op) continue;

    const sections: MCPSectionDelta[] = [];
    const fromPage = fromPagesMap.get(p.path);
    const toPage = toPagesMap.get(p.path);

    for (const s of p.added_sections) {
      sections.push({
        anchor: s.anchor,
        heading: s.heading,
        content: `<after_change>${escapeInlineTags(s.content)}</after_change>`,
      });
    }
    for (const s of p.removed_sections) {
      sections.push({
        anchor: s.anchor,
        heading: s.heading,
        content: `<before_change>${escapeInlineTags(s.content)}</before_change>`,
      });
    }
    for (const s of p.modified_sections) {
      sections.push({
        anchor: s.anchor,
        heading: s.heading,
        content: projectLineDiffToInlineTags(s.line_diff),
      });
    }
    // Pure moves only — M02 invariant: anchor jest w `moved_sections` XOR
    // w `modified_sections` (patrz `file-serializer.ts` w `FileSerializer.diff`),
    // ale filtrujemy defensywnie. Heading wyciągamy parsując `toPage.content`,
    // bo `MovedSectionLite` nie niesie heading'u.
    if (p.moved_sections.length > 0) {
      const modifiedAnchors = new Set(p.modified_sections.map((s) => s.anchor));
      const toContent = (toPage?.data as { content?: string } | undefined)?.content;
      const headingMap = toContent
        ? new Map(parseSections(toContent).map((s) => [s.anchor, s.heading]))
        : new Map<string, string>();
      for (const s of p.moved_sections) {
        if (modifiedAnchors.has(s.anchor)) continue;
        sections.push({
          anchor: s.anchor,
          heading: headingMap.get(s.anchor) ?? '',
          moved: true,
        });
      }
    }

    const pageDelta: MCPPageDelta = { path: p.path, op, sections };

    if (p.frontmatter_diff != null) {
      const frontmatter: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {};
      if (op !== 'create') {
        const fm = (fromPage?.data as { frontmatter?: Record<string, unknown> } | undefined)?.frontmatter;
        if (fm !== undefined) frontmatter.before = fm;
      }
      if (op !== 'delete') {
        const fm = (toPage?.data as { frontmatter?: Record<string, unknown> } | undefined)?.frontmatter;
        if (fm !== undefined) frontmatter.after = fm;
      }
      pageDelta.frontmatter = frontmatter;
    }

    if (p.xml_refs_diff != null) {
      const xmlRefs: { before?: string[]; after?: string[] } = {};
      if (op !== 'create') {
        const refs = (fromPage?.data as { xml_refs?: PageXmlRefLite[] } | undefined)?.xml_refs;
        if (refs !== undefined) xmlRefs.before = refs.map(renderXmlRef);
      }
      if (op !== 'delete') {
        const refs = (toPage?.data as { xml_refs?: PageXmlRefLite[] } | undefined)?.xml_refs;
        if (refs !== undefined) xmlRefs.after = refs.map(renderXmlRef);
      }
      pageDelta.xmlRefs = xmlRefs;
    }

    out.push(pageDelta);
  }
  return out;
}

/** MCP-only default window size for `release_show` / `release_list` (M17). */
export const DEFAULT_PAGE_LIMIT = 5;

export function projectSpecSnapshot(
  raw: SpecSnapshot,
  opts: ProjectionOpts,
  pagination?: { limit?: number; offset?: number },
): MCPSpecSnapshot {
  const limit = pagination?.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = pagination?.offset ?? 0;
  const out: MCPSpecSnapshot = {
    release: {
      id: raw.release.id,
      name: raw.release.name,
      description: raw.release.description,
      created_by: raw.release.createdBy,
      created_at: raw.release.createdAt,
    },
    total: {},
  };
  /*
   * limit/offset apply independently to each list; `total` is the full count
   * after include/entityTypes filtering but before the window is sliced.
   *
   * 0.2.40 — and the response BUDGET applies on top, spent across both lists in
   * order, exactly as in `projectReleaseDiff`. Degradation here can only ever be
   * a narrower window: a row is already nothing but identity, so there is no
   * heavy half to shed and no per-row marker that would mean anything. What the
   * caller needs is the cursor, which is what `truncationHint` carries.
   */
  const hints: string[] = [];
  let spent = 0;
  const remaining = (): number => Math.max(DEFAULT_BUDGET_CHARS - spent, 0);
  const windowOf = <T,>(all: readonly T[], dimension: 'entities' | 'pages'): T[] => {
    const requested = all.slice(offset, offset + limit);
    const items = fitToBudget(requested, remaining());
    if (items.length < requested.length) {
      hints.push(
        `the ${dimension} window was cut short by the response budget — ` +
          `continue with \`offset: ${offset + items.length}\`, or ask for a smaller \`limit\` ` +
          `(\`total\` reports the full count).`,
      );
    }
    spent += JSON.stringify(items)?.length ?? 0;
    return items;
  };

  if (opts.include.includes('entities')) {
    const entities = raw.entities
      .filter((e) => e.op !== 'delete')
      .filter((e) => !opts.entityTypes || opts.entityTypes.includes(e.type as EntityTypeFilter))
      .map((e) => ({
        type: e.type,
        slug: e.slug,
        name: extractEntityName(e.data as EntitySnapshot, e.slug),
      }));
    out.total.entities = entities.length;
    out.entities = windowOf(entities, 'entities');
  }
  if (opts.include.includes('pages')) {
    const pages = raw.pages.filter((p) => p.op !== 'delete').map((p) => ({ path: p.path }));
    out.total.pages = pages.length;
    out.pages = windowOf(pages, 'pages');
  }
  if (hints.length > 0) out.truncationHint = hints.join(' ');
  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function indexEntitiesByTypeSlug(
  rows: SpecSnapshotEntityRow[],
): Map<string, SpecSnapshotEntityRow> {
  const m = new Map<string, SpecSnapshotEntityRow>();
  for (const r of rows) m.set(`${r.type}|${r.slug}`, r);
  return m;
}

function indexPagesByPath(rows: SpecSnapshotPageRow[]): Map<string, SpecSnapshotPageRow> {
  const m = new Map<string, SpecSnapshotPageRow>();
  for (const r of rows) m.set(r.path, r);
  return m;
}

/**
 * L2's entity vocabulary → L3's. The two are deliberately different: L2 returns
 * the raw delta (four states, `noop` included), L3 projects it (three states,
 * no `noop` — an unchanged entity is simply absent from the projection). 0.2.31
 * renamed L2's middle state `modified` → `updated`; L3's stays `update`.
 */
function mapEntityOp(op: RawEntityOp): MCPOp | null {
  if (op === 'created') return 'create';
  if (op === 'updated') return 'update';
  if (op === 'deleted') return 'delete';
  return null;
}

function mapPageOp(op: RawPageOp): MCPOp | null {
  if (op === 'created') return 'create';
  if (op === 'modified') return 'update';
  if (op === 'deleted') return 'delete';
  return null;
}

const ESCAPE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['<before_change>', '&lt;before_change&gt;'],
  ['</before_change>', '&lt;/before_change&gt;'],
  ['<after_change>', '&lt;after_change&gt;'],
  ['</after_change>', '&lt;/after_change&gt;'],
];

export function escapeInlineTags(s: string): string {
  let out = s;
  for (const [from, to] of ESCAPE_PAIRS) out = out.split(from).join(to);
  return out;
}

/**
 * Project structural `LineDiffLite` (M02 `m02pvdif1`) into a single markdown
 * string with inline `<before_change>` / `<after_change>` tags.
 *
 * Adjacency rules:
 * - Sąsiednie linijki tej samej operacji łączymy w jeden tag.
 * - Sąsiedni blok `removed` bezpośrednio przed blokiem `added` daje
 *   `<before_change>…</before_change><after_change>…</after_change>`
 *   (before pierwszy, oba tagi sąsiadują, brak `keep` między nimi).
 *   Replace bloku N→M linii w wire-format z `diffLines` to właśnie taki układ.
 * - `keep` linie emitowane bez tagów.
 * - Literalne `<before_change>` / `<after_change>` w treści sekcji są
 *   escape'owane do encji XML we wszystkich liniach (keep/add/remove),
 *   safety-net na kolizję z markerami.
 *
 * `LineDiff` jest już noise-stripped przez `computeLineDiff` (orphan M06
 * anchory + puste linie w `added`/`removed` odfiltrowane), więc emitowany
 * string nie jest byte-exact rekonstrukcją snapshotu — to intencjonalne.
 */
export function projectLineDiffToInlineTags(diff: LineDiffLite): string {
  const out: string[] = [];
  let removeBuf: string[] = [];
  let addBuf: string[] = [];

  const flush = (): void => {
    if (removeBuf.length > 0) {
      out.push(`<before_change>${removeBuf.join('\n')}</before_change>`);
      removeBuf = [];
    }
    if (addBuf.length > 0) {
      out.push(`<after_change>${addBuf.join('\n')}</after_change>`);
      addBuf = [];
    }
  };

  for (const line of diff.lines) {
    const content = escapeInlineTags(line.content);
    if (line.op === 'keep') {
      flush();
      out.push(content);
    } else if (line.op === 'removed') {
      // Jeśli mamy buforowany `added` z poprzedniego cyklu (pure-add przed
      // remove'em), zamknij go najpierw — before zawsze przed after w ramach
      // tego samego "modify" bloku, ale dwa niezależne bloki muszą być
      // wyemitowane w kolejności wystąpienia.
      if (addBuf.length > 0) flush();
      removeBuf.push(content);
    } else {
      // 'added'
      addBuf.push(content);
    }
  }
  flush();
  return out.join('\n');
}

export function renderXmlRef(r: PageXmlRefLite): string {
  const attrs = Object.entries(r.attributes)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return `<${r.tagType}${attrs ? ' ' + attrs : ''}/>`;
}

export function extractEntityName(s: EntitySnapshot | undefined, slug: string): string {
  if (!s) return slug;
  if (typeof s.name === 'string') return s.name;
  if (typeof s.title === 'string') return s.title;
  return slug;
}
