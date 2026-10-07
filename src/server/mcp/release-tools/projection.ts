/**
 * Pure projection functions: `RawDelta` / `SpecSnapshot` (L2) → MCP-friendly
 * self-contained shapes (`MCPReleaseDiff` / `MCPSpecSnapshot`). No I/O,
 * no DB access — caller hands raw inputs in.
 */

import type {
  FileDiff,
  LineDiffLite,
  PageXmlRefLite,
  RawDelta,
  RawDeltaEntityChange,
  SectionKey,
  SpecSnapshot,
  SpecSnapshotEntityRow,
  SpecSnapshotPageRow,
} from '../../../shared/entities.js';
import { CURRENT_RELEASE_NAME } from '../../../shared/entities.js';
import { headingPathOf, parseSections } from '../../../shared/section-parser.js';
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
  MCPSectionMapRow,
  MCPSpecSnapshot,
  ProjectionOpts,
} from './types.js';

type RawEntityOp = RawDeltaEntityChange['op'];
type RawPageOp = FileDiff['op'];
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

/*
 * The wording distinguishes the two mechanisms on purpose. Saying "lost their
 * payload" of everything would be wrong for a section — its `content` is still
 * there, only shorter — and a consumer told its sections were dropped would
 * refetch work it already has.
 */
/*
 * 2.1.5 — the retry instruction is a LADDER, top to bottom: the page window, one
 * page (`paths`), that page's section window, and `summaryOnly` as the floor.
 * 2.1.11 adds the one-entity rung (`entityTypes` with one type + `slugs`) between
 * the window and the one page. Below the floor there is nothing — the budget sits
 * under the transport ceiling, so a smaller slice is the only way to more content.
 */
const HEAVY_RETRY_HINT =
  'response budget exceeded — every item past the cut is still here, marked `truncated: true`: entities kept ' +
  'their identity and lost `before`/`after` entirely, sections kept `content` cut short as text. Nothing was ' +
  'omitted, so an item ABSENT from this response is one that did not change. Retry narrower, rung by rung: ' +
  '(1) the page window — pass `entityTypes` to restrict the entity dimension, lower `limit`, advance `offset` to ' +
  'reach the items that degraded; (2) one entity — `entityTypes` with its one type plus `slugs` set to it; ' +
  '(3) one page — `paths` set to it; (4) that page\'s section window — `sectionOffset` / `sectionLimit`, ' +
  '`sectionLimit: 1` reads it section by section; (5) `summaryOnly: true` for the identity map of the whole ' +
  'delta, with a `size` per page to plan the slices.';

/**
 * 2.1.11 — the concrete rung-2 pointer for the first entity whose `before` /
 * `after` fell out of the budget: one entity is always served whole (the first
 * item never degrades), so this call answers it in full.
 */
function entityHint(entity: MCPEntityDelta): string {
  return (
    `entity \`${entity.type}/${entity.slug}\` lost its \`before\`/\`after\` to the budget — read it with ` +
    `\`entityTypes: ['${entity.type}'], slugs: ['${entity.slug}']\`.`
  );
}

/**
 * The concrete rung-4 pointer for one page whose sections did not fit: its
 * `paths`, the position where the next window starts, and a `sectionLimit` no
 * bigger than what just fitted — without one, a page whose section identities
 * alone outgrow the budget would answer every follow-up oversized again.
 * `paths` and `roots` are mutually exclusive, so the pointer says to drop `roots`.
 */
function sectionWindowHint(page: MCPPageDelta, sectionOffset: number, fitted: number): string {
  return (
    `page \`${page.rootId}/${page.path}\` did not fit from section ${sectionOffset} on — continue with ` +
    `\`paths: ['${page.rootId}/${page.path}'], sectionOffset: ${sectionOffset}, sectionLimit: ${Math.max(fitted, 1)}\` ` +
    `(without \`roots\`, which \`paths\` replaces; \`total.sections\` counts its changed sections; the page is ` +
    `read whole once the windows covered every position).`
  );
}

/**
 * What the envelope around a section-budgeted page costs: `from`/`to`/`total`
 * and the two hints it may carry. Section-level budgeting is the one place that
 * fills the budget to the brim, so it is the one place that has to leave this out.
 */
function envelopeReserve(out: MCPReleaseDiff): number {
  // `entities` is already charged to `spent`; only the frame is left to count.
  const { entities: _entities, pages: _pages, ...frame } = out;
  return (JSON.stringify(frame)?.length ?? 0) + HEAVY_RETRY_HINT.length + 600;
}

/** Options of `projectReleaseDiff` — the page window, the light switch and the section window. */
export interface ReleaseDiffWindow {
  summaryOnly?: boolean;
  limit?: number;
  offset?: number;
  /**
   * 2.1.5 — the caller addressed exactly ONE page through `paths`. Turns on
   * `total.sections`, the light `sectionMap` and the section window. The tool
   * refuses a section window without it, so here it is a plain switch.
   */
  singlePath?: boolean;
  sectionOffset?: number;
  sectionLimit?: number;
}

/**
 * Project a raw delta, applying the response budget on the way out.
 *
 * In the HEAVY path the budget is spent across both dimensions in order
 * (entities, then pages), not halved between them: the caller paid for one
 * response, and a fixed split would degrade a small pages dimension to make
 * room for entities that never arrived. Nothing becomes unreachable that way,
 * because the heavy path never drops a row — the overflow only degrades, in
 * place, marked.
 *
 * The LIGHT path (`summaryOnly`) splits instead, and must. There a row past the
 * budget is POSTPONED, and the only way to reach it is `offset` — one parameter
 * shared by both dimensions. Spending in order starves the second dimension to
 * a single row while the first consumes the budget, so the two hints name two
 * different offsets and the caller can follow at most one of them; advancing to
 * the entities' cursor would skip the postponed pages permanently and silently,
 * which is the exact failure the whole release is written against. An equal
 * share keeps each dimension's cursor independently followable, and the hint
 * says to page one dimension at a time.
 */
/**
 * The `to` side of the envelope. L2 stamps the unreleased branch's "to" as
 * `{ id: 0, name: 'current' }` — a synthetic row id it needs internally to reuse
 * `computeDelta` — but 0 is a release id shape, and the MCP consumer must be able
 * to tell "not frozen" from "release #0" without knowing that. `null` is that
 * signal, and this is the one place the translation happens: both the SQL and the
 * git-anchored unreleased paths come through here, so neither can forget it.
 */
function projectTo(to: RawDelta['to']): MCPReleaseDiff['to'] {
  return to.name === CURRENT_RELEASE_NAME && to.id === 0 ? { id: null, name: to.name } : to;
}

export function projectReleaseDiff(
  raw: RawDelta,
  fromSnap: SpecSnapshot | null,
  toSnap: SpecSnapshot,
  opts: ProjectionOpts,
  options?: ReleaseDiffWindow,
): MCPReleaseDiff {
  const summaryOnly = options?.summaryOnly ?? false;
  const limit = options?.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = options?.offset ?? 0;
  const singlePath = options?.singlePath ?? false;
  const sectionOffset = options?.sectionOffset ?? 0;
  const sectionLimit = options?.sectionLimit;
  const out: MCPReleaseDiff = { from: raw.from, to: projectTo(raw.to), total: {} };
  const hints: string[] = [];
  let spent = 0;
  const remaining = (): number => Math.max(DEFAULT_BUDGET_CHARS - spent, 0);
  /** The light path's equal share — see the note on postponement above. */
  const lightDims = opts.include.filter((d) => d === 'entities' || d === 'pages').length;
  const lightShare = Math.floor(DEFAULT_BUDGET_CHARS / Math.max(lightDims, 1));
  const charge = (value: unknown): void => {
    spent += JSON.stringify(value)?.length ?? 0;
  };

  // Compute the FULL filtered delta first, record `total` on it, THEN branch:
  // light (`summaryOnly`) strips to identifiers; heavy slices
  // `entities[]`/`pages[]` independently by the same `limit`/`offset`.
  if (opts.include.includes('entities')) {
    const full = projectEntities(raw.entities, fromSnap, toSnap, opts.entityTypes, opts.slugs);
    out.total!.entities = full.length;
    if (summaryOnly) {
      const light = full.map(toEntityLight);
      const { items, hint } = budgetLightMap(light, offset, lightShare, 'entities');
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
      if (budgeted.truncated) {
        hints.push(HEAVY_RETRY_HINT);
        const firstCut = budgeted.items.find((e) => e.truncated);
        if (firstCut) hints.push(entityHint(firstCut));
      }
    }
    charge(out.entities);
  }
  if (opts.include.includes('pages')) {
    const full = projectPages(raw.pages, fromSnap, toSnap);
    out.total!.pages = full.length;
    // 2.1.5 — counted after filters, BEFORE the section window, so a window
    // never changes it. Computed after the section diff and the MCP projection,
    // which is why the git and SQLite tracks both get it for free.
    if (singlePath) out.total!.sections = full.reduce((n, p) => n + p.sections.length, 0);
    if (summaryOnly) {
      // The light path ignores the section window, exactly as it ignores the page window.
      const light = full.map((p) => toPageLight(p, singlePath));
      const { items, hint } = budgetLightMap(light, offset, lightShare, 'pages');
      out.pages = items;
      if (hint) hints.push(hint);
    } else if (singlePath) {
      out.pages = full.slice(offset, offset + limit).map((page) => {
        const windowed = windowSections(page, sectionOffset, sectionLimit);
        const { page: fitted, cutAt, fitted: whole } = budgetSections(
          windowed,
          sectionOffset,
          remaining() - envelopeReserve(out),
          true,
        );
        if (cutAt !== undefined) {
          hints.push(HEAVY_RETRY_HINT);
          if (cutAt < out.total!.sections!) hints.push(sectionWindowHint(fitted, cutAt, whole));
        }
        return fitted;
      });
    } else {
      /*
       * ONE room for the whole page window, shared at SECTION level. Pages are
       * served whole, in order, while they fit; from the first that does not,
       * every page keeps all its sections' identities and `content` only as far
       * as the room left reaches. Pages past the cut are CHARGED like any other —
       * a degraded tail outside the budget is how a "budgeted" response used to
       * outgrow the transport ceiling. Only the window's first page keeps the
       * first-item guarantee (its first section is never empty).
       */
      const windowPages = full.slice(offset, offset + limit);
      let left = remaining() - envelopeReserve(out);
      /** Identity cost of the pages after `i` — reserved before a cut page spends the room. */
      let tailIdentity: number[] | undefined;
      let pointer: string | undefined;
      out.pages = windowPages.map((page, i) => {
        if (tailIdentity === undefined) {
          const cost = (JSON.stringify(page)?.length ?? 0) + 1;
          if (cost <= left) {
            left -= cost;
            return page;
          }
          tailIdentity = suffixSums(windowPages.map(pageIdentityCost));
        }
        const reserve = tailIdentity[i + 1] ?? 0;
        const { page: fitted, cutAt, fitted: whole } = budgetSections(page, 0, left - reserve, i === 0);
        left -= (JSON.stringify(fitted)?.length ?? 0) + 1;
        // Rung 4, made concrete: the first page whose sections came back cut,
        // and where its section window should resume.
        if (pointer === undefined && cutAt !== undefined && cutAt < page.sections.length) {
          pointer = sectionWindowHint(fitted, cutAt, whole);
        }
        return fitted;
      });
      if (tailIdentity !== undefined) {
        hints.push(HEAVY_RETRY_HINT);
        if (pointer) hints.push(pointer);
      }
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
    /*
     * The hint names `include` as well as `offset`, and that is not padding:
     * `offset` is ONE parameter over two dimensions, so a cursor is only
     * followable while a single dimension is in play. Told merely to advance,
     * a caller paging a two-dimension response would carry the entities'
     * cursor onto the pages map and skip the very rows this hint exists to
     * promise are still reachable.
     */
    hint:
      `the ${dimension} identity map does not fit in one response — ` +
      `continue with \`include: ['${dimension}'], offset: ${offset + items.length}\` ` +
      `(\`total\` reports the full count; \`offset\` is shared by both dimensions, so page one at a time). ` +
      `No row was dropped, only postponed.`,
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

/*
 * A page past the budget keeps every section and every `content`, cut as TEXT —
 * the opposite choice to `degradeEntity`, and for the opposite reason: a section
 * body is prose with inline diff tags, and a prefix of it is still prose with
 * inline diff tags. 2.1.5: the cut is `budgetSections`, charged against the ONE
 * room of the response. The 0.2.40 whole-page ceiling (8 000 characters per
 * degraded page, OUTSIDE the budget) is gone: four degraded pages of two hundred
 * sections each added ~100 000 characters on top of a "budgeted" response.
 */

/**
 * 2.1.5 — the section window of the one page addressed through `paths`.
 *
 * POSITIONAL, not a filter over anchors: the positions are the order `sections[]`
 * comes back in without a window, so an anchorless create/delete-only section
 * and the preamble are addressable too, and a pure move occupies a position like
 * any other. `frontmatter` / `xmlRefs` belong to the window starting at 0 only,
 * so a page read window by window carries them exactly once. A window past the
 * end is an empty list, not an error — `total.sections` says where the end is.
 */
function windowSections(page: MCPPageDelta, sectionOffset: number, sectionLimit: number | undefined): MCPPageDelta {
  if (sectionOffset === 0 && sectionLimit === undefined) return page;
  const { frontmatter, xmlRefs, ...rest } = page;
  const end = sectionLimit === undefined ? undefined : sectionOffset + sectionLimit;
  return {
    ...rest,
    sections: page.sections.slice(sectionOffset, end),
    ...(sectionOffset === 0 && frontmatter !== undefined ? { frontmatter } : {}),
    ...(sectionOffset === 0 && xmlRefs !== undefined ? { xmlRefs } : {}),
  };
}

/**
 * 2.1.5 — the response budget at SECTION level, for the one page addressed
 * through `paths`. The window bounds how many sections, the budget how big they
 * get; the two are independent.
 *
 * The first-item guarantee holds here at the level of the section: a first
 * section bigger than the budget on its own comes back with `content` cut as
 * text and `truncated: true` — never empty, because an empty answer leaves no
 * smaller window to ask for. Sections past the cut keep their identity and a
 * degraded prefix, exactly as on a degraded page. `cutAt` is the absolute
 * position where the next window should start.
 */
function budgetSections(
  page: MCPPageDelta,
  sectionOffset: number,
  budgetChars: number,
  guaranteeFirst: boolean,
): { page: MCPPageDelta; cutAt?: number; fitted: number } {
  if ((JSON.stringify(page)?.length ?? 0) <= budgetChars) return { page, fitted: page.sections.length };
  // Every section keeps its identity, so that is paid for up front; what is left
  // is shared out as content, in order, until it runs out.
  const identity = (sec: MCPSectionDelta): number =>
    (JSON.stringify({ ...sec, content: '', truncated: true })?.length ?? 0) + 1;
  const shell = JSON.stringify({ ...page, sections: [] })?.length ?? 0;
  let room = budgetChars - shell - page.sections.reduce((n, sec) => n + identity(sec), 0);
  let cutAt: number | undefined;
  let fitted = 0;
  const sections = page.sections.map((sec, i) => {
    if (sec.content === undefined) return sec;
    const cost = jsonTextLength(sec.content);
    if (cutAt === undefined && cost <= room) {
      room -= cost;
      return sec;
    }
    // The first section past the line is where the next window starts — unless
    // it is the guaranteed first, which no smaller window can make bigger
    // (there is no character window yet), so the next window starts after it.
    const guaranteed = guaranteeFirst && i === 0;
    if (cutAt === undefined) {
      cutAt = sectionOffset + (guaranteed ? 1 : i);
      fitted = guaranteed ? 1 : i;
    }
    // Never empty for the guaranteed first section: an empty answer leaves no
    // smaller window to ask for.
    const allowance = guaranteed ? Math.max(room, DEGRADED_SECTION_CHARS) : Math.max(room, 0);
    const content = sliceToJsonLength(sec.content, allowance);
    room -= jsonTextLength(content);
    return { ...sec, content, truncated: true as const };
  });
  return cutAt === undefined ? { page, fitted: page.sections.length } : { page: { ...page, sections }, cutAt, fitted };
}

/** What a page costs once every section is cut to its identity — the floor a degraded page never goes under. */
function pageIdentityCost(page: MCPPageDelta): number {
  const sections = page.sections.map((sec) =>
    sec.content === undefined ? sec : { ...sec, content: '', truncated: true as const },
  );
  return (JSON.stringify({ ...page, sections })?.length ?? 0) + 1;
}

/** `out[i]` = sum of `costs[i..]`; `out[costs.length]` = 0. */
function suffixSums(costs: readonly number[]): number[] {
  const out = new Array<number>(costs.length + 1).fill(0);
  for (let i = costs.length - 1; i >= 0; i--) out[i] = out[i + 1]! + costs[i]!;
  return out;
}

/** Serialized length of a string's JSON body, without the quotes. */
function jsonTextLength(text: string): number {
  return JSON.stringify(text).length - 2;
}

/** The longest prefix whose JSON body fits `max` — escapes make that shorter than `max` characters. */
function sliceToJsonLength(text: string, max: number): string {
  let cut = text.slice(0, max);
  while (cut.length > 0 && jsonTextLength(cut) > max) {
    cut = cut.slice(0, Math.floor((cut.length * max) / jsonTextLength(cut)) - 1);
  }
  return cut;
}

/** Strip a heavy entity delta to its light identifier form (`summaryOnly: true`). */
function toEntityLight(e: MCPEntityDelta): MCPEntityDeltaLight {
  return { type: e.type, slug: e.slug, name: e.name, op: e.op };
}

/**
 * 2.1.5 — a section's size in the budget's unit: the length of its heavy-mode
 * `content`, without the serialization overhead. A pure move carries none.
 */
function sectionSize(s: MCPSectionDelta): number {
  return s.moved ? 0 : (s.content?.length ?? 0);
}

/**
 * Strip a heavy page delta to its light form (`summaryOnly: true`): identity,
 * op, and the page's size so slices can be planned before content is pulled.
 * With exactly one path, the page's section map rides along — one fixed-width
 * row per changed section, in section-window order.
 */
function toPageLight(p: MCPPageDelta, withSectionMap: boolean): MCPPageDeltaLight {
  const row: MCPPageDeltaLight = {
    rootId: p.rootId,
    path: p.path,
    op: p.op,
    sections: p.sections.length,
    size: p.sections.reduce((n, sec) => n + sectionSize(sec), 0),
  };
  if (withSectionMap) row.sectionMap = p.sections.map(toSectionMapRow);
  return row;
}

function toSectionMapRow(s: MCPSectionDelta): MCPSectionMapRow {
  return {
    ...(s.anchor !== undefined ? { anchor: s.anchor } : {}),
    kind: s.kind,
    ...(s.heading !== undefined ? { heading: s.heading } : {}),
    headingPath: s.headingPath,
    ...(s.moved ? { moved: true as const } : {}),
    size: sectionSize(s),
  };
}

function projectEntities(
  rawEntities: RawDeltaEntityChange[],
  fromSnap: SpecSnapshot | null,
  toSnap: SpecSnapshot,
  entityTypes: EntityTypeFilter[] | undefined,
  slugs?: string[],
): MCPEntityDelta[] {
  const fromMap = indexEntitiesByTypeSlug(fromSnap?.entities ?? []);
  const toMap = indexEntitiesByTypeSlug(toSnap.entities);
  const out: MCPEntityDelta[] = [];

  for (const e of rawEntities) {
    if (e.op === 'noop') continue;
    if (entityTypes && !entityTypes.includes(e.type as EntityTypeFilter)) continue;
    if (slugs && !slugs.includes(e.slug)) continue;

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
  rawPages: FileDiff[],
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
    const fromTree = sectionTree((fromPage?.data as { content?: string } | undefined)?.content);
    const toTree = sectionTree((toPage?.data as { content?: string } | undefined)?.content);

    const head = (s: SectionKey, tree: SectionTree): Omit<MCPSectionDelta, 'content'> =>
      s.kind === 'preamble'
        ? { kind: 'preamble', anchor: s.anchor ?? PREAMBLE, headingPath: [] }
        : {
            kind: 'section',
            ...(s.anchor !== null ? { anchor: s.anchor } : {}),
            headingPath: s.headingPath ?? tree.pathOf(s),
            ...(s.heading !== null ? { heading: s.heading } : {}),
          };

    for (const s of p.added_sections) {
      sections.push({ ...head(s, toTree), content: `<after_change>${escapeInlineTags(s.content)}</after_change>` });
    }
    for (const s of p.removed_sections) {
      sections.push({ ...head(s, fromTree), content: `<before_change>${escapeInlineTags(s.content)}</before_change>` });
    }
    for (const s of p.modified_sections) {
      // The own body carries no heading line, so a renamed / re-levelled heading
      // is stated up front as its own before/after pair.
      const before = s.anchor !== null ? fromTree.headingLineOf(s.anchor) : null;
      const after = s.kind === 'section' && s.heading !== null ? `${'#'.repeat(s.level ?? 1)} ${s.heading}` : null;
      const headingChange =
        before !== null && after !== null && before !== after
          ? `<before_change>${escapeInlineTags(before)}</before_change>\n<after_change>${escapeInlineTags(after)}</after_change>\n`
          : '';
      sections.push({ ...head(s, toTree), content: headingChange + projectLineDiffToInlineTags(s.line_diff) });
    }
    // Pure moves only: a moved section that also changed is already listed as
    // modified above. The heading comes from the `to` snapshot's parse, because
    // a move entry carries only its anchor.
    if (p.moved_sections.length > 0) {
      const modifiedAnchors = new Set(p.modified_sections.map((s) => s.anchor));
      for (const s of p.moved_sections) {
        if (modifiedAnchors.has(s.anchor)) continue;
        const key = toTree.keyOf(s.anchor);
        sections.push({
          kind: 'section',
          anchor: s.anchor,
          headingPath: key ? toTree.pathOf({ kind: 'section', anchor: s.anchor, heading: key.heading, level: null, parent: null, headingPath: [] }) : [],
          heading: key?.heading ?? '',
          moved: true,
        });
      }
    }

    const pageDelta: MCPPageDelta = { rootId: p.rootId, path: p.path, op, sections };

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

const PREAMBLE = '~preamble';

interface SectionTree {
  /** Ancestor headings of a diff entry, outermost first. */
  pathOf(key: SectionKey): string[];
  /** The markdown heading line of an anchored section, or null. */
  headingLineOf(anchor: string): string | null;
  keyOf(anchor: string): { heading: string } | null;
}

/**
 * One snapshot's section tree, from the shared section parser — the same split
 * the diff was computed with, so `headingPath` names the same ancestors the
 * diff saw. A section without an anchor is found by its heading text.
 */
function sectionTree(content: string | undefined): SectionTree {
  const parsed = content === undefined ? null : parseSections(content);
  const find = (key: { anchor: string | null; heading: string | null }) =>
    parsed?.sections.find((s) =>
      key.anchor !== null && key.anchor !== PREAMBLE ? s.anchor === key.anchor : s.anchor === null && s.heading === key.heading,
    ) ?? null;
  return {
    pathOf: (key) => {
      if (!parsed || key.kind === 'preamble') return [];
      const sec = find(key);
      return sec ? headingPathOf(parsed, sec) : [];
    },
    headingLineOf: (anchor) => {
      const sec = find({ anchor, heading: null });
      return sec ? `${'#'.repeat(sec.level)} ${sec.heading}` : null;
    },
    keyOf: (anchor) => {
      const sec = find({ anchor, heading: null });
      return sec ? { heading: sec.heading } : null;
    },
  };
}

/** Default operation window for `release_list` / `release_show` / `release_diff`, in every channel (M17, 2.1.11). */
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
