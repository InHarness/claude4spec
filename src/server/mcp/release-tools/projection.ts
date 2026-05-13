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
import { parseSections } from '../../services/page-serializer.js';
import type {
  EntitySnapshot,
  EntityTypeFilter,
  MCPEntityDelta,
  MCPPageDelta,
  MCPReleaseDiff,
  MCPSectionDelta,
  MCPSpecSnapshot,
  ProjectionOpts,
} from './types.js';

type RawEntityOp = RawDeltaEntityChange['op'];
type RawPageOp = RawDeltaPageChange['op'];
type MCPOp = 'create' | 'update' | 'delete';

const ENTITY_TYPES: ReadonlySet<EntityTypeFilter> = new Set([
  'endpoint',
  'dto',
  'database-table',
  'ui-view',
  'ac',
]);

export function projectReleaseDiff(
  raw: RawDelta,
  fromSnap: SpecSnapshot | null,
  toSnap: SpecSnapshot,
  opts: ProjectionOpts,
): MCPReleaseDiff {
  const out: MCPReleaseDiff = { from: raw.from, to: raw.to };

  if (opts.include.includes('entities')) {
    out.entities = projectEntities(raw.entities, fromSnap, toSnap, opts.entityTypes);
  }
  if (opts.include.includes('pages')) {
    out.pages = projectPages(raw.pages, fromSnap, toSnap);
  }
  return out;
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
    if (!ENTITY_TYPES.has(e.type as EntityTypeFilter)) continue;
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
    // w `modified_sections` (patrz `page-serializer.ts` w `PageSerializer.diff`),
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

export function projectSpecSnapshot(raw: SpecSnapshot, opts: ProjectionOpts): MCPSpecSnapshot {
  const out: MCPSpecSnapshot = {
    release: {
      id: raw.release.id,
      name: raw.release.name,
      description: raw.release.description,
      created_by: raw.release.createdBy,
      created_at: raw.release.createdAt,
    },
  };
  if (opts.include.includes('entities')) {
    out.entities = raw.entities
      .filter((e) => e.op !== 'delete')
      .filter((e) => !opts.entityTypes || opts.entityTypes.includes(e.type as EntityTypeFilter))
      .map((e) => ({
        type: e.type,
        slug: e.slug,
        name: extractEntityName(e.data as EntitySnapshot, e.slug),
      }));
  }
  if (opts.include.includes('pages')) {
    out.pages = raw.pages.filter((p) => p.op !== 'delete').map((p) => ({ path: p.path }));
  }
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

function mapEntityOp(op: RawEntityOp): MCPOp | null {
  if (op === 'created') return 'create';
  if (op === 'modified') return 'update';
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
