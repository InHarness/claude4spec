/**
 * FileSerializer — the AUTHORED versioning mechanism for markdown files (pages,
 * briefs, patches): `version` / `snapshot` / `restore` / `diff`, hand-written
 * rather than generated from a logical schema, because a file has none. M02 does
 * not register the page through `registerEntityModule` (M17 decyzja 1) — files
 * on disk run a track parallel to entities in SQLite, so this serializer sits
 * outside the `EntitySerializer` registry.
 *
 * 0.2.46 — that is NOT the same as "the page is outside M13", a claim this file
 * used to make and which is hereby withdrawn as misleading. M13 is a registry of
 * RECORD SHAPES emitted to external consumers, not a registry of entity types:
 * it declares the page in the `host foundational type` role (the second one,
 * alongside `section`), with identity key `(rootId, path)` and the record shape
 * `GetPageResult`. This class is M17's versioning machinery, not an M13
 * generation — the two interfaces neither collide nor replace each other.
 *
 * Snapshot shape — `FileSnapshotData` per `db-m17-snapshots.md` (`dbm17shp01`).
 * Diff variant C (M17 decyzja 10): section-level operations + mandatory
 * `line_diff` inside each entry of `modified_sections` + `frontmatter_diff` /
 * `xml_refs_diff` side-channels.
 *
 * 2.0.0 — both sides of a diff go through the SHARED SECTION PARSER (M06), so
 * the diff never splits content itself and its boundaries are the index's:
 * entries are keyed by anchor plus the reserved `~preamble`, and every entry
 * compares a section's OWN body — a change inside a subsection is the
 * subsection's entry alone, never its parent's.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { diffLines } from 'diff';
import { ANCHOR_LINE_RE } from '../../shared/anchor-pattern.js';
import { parseXmlTags } from '../../shared/xml-tags.js';
import {
  fileKindOf,
  headingPathOf,
  liveAnchorValues,
  parseSections,
  PREAMBLE_KEY,
  sliceLines,
  type SectionFileKind,
} from '../../shared/section-parser.js';
import type { PagesService } from './pages.js';
import type {
  FileDiff,
  FileDiffModifiedSection,
  FileDiffSection,
  FrontmatterDiffLite,
  LineDiffLineLite,
  LineDiffLite,
  PageXmlRefLite,
  SectionKey,
  XmlRefsDiffLite,
} from '../../shared/entities.js';
type FileSection = FileDiffSection;
type ModifiedSection = FileDiffModifiedSection;
type LineDiff = LineDiffLite;
type LineDiffLine = LineDiffLineLite;
type FrontmatterDiff = FrontmatterDiffLite;
type XmlRefsDiff = XmlRefsDiffLite;

export const FILE_SERIALIZER_VERSION = '1.1.0';


export type FileXmlRef = PageXmlRefLite;

export interface FileSnapshotData {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  /**
   * 2.0.0 — computed by the section parser at capture (anchor lines inside
   * code blocks excluded), and INFORMATIONAL ONLY: the diff always re-parses
   * `content` and never reads this. Old `file_version` rows, captured before the
   * parser, can carry anchors from inside code blocks; ignoring the field is
   * what keeps them from producing phantom sections.
   */
  anchors: string[];
  xml_refs: FileXmlRef[];
}

/** The diff contract lives in `src/shared/entities.ts` — the client renders it as is. */
export type {
  FileDiff,
  SectionKey,
  FileDiffSection as FileSection,
  FileDiffModifiedSection as ModifiedSection,
  LineDiffLite as LineDiff,
  LineDiffLineLite as LineDiffLine,
  FrontmatterDiffLite as FrontmatterDiff,
  XmlRefsDiffLite as XmlRefsDiff,
};

/**
 * Compute line-level diff between two strings using Myers algorithm
 * (via `diff` npm). Returns a flat list of keep/added/removed lines
 * preserving order. Trailing newlines are normalized so identical
 * content with/without final \n compares equal.
 *
 * Noise filter (2.0.0): an added/removed line that is blank, or an orphan
 * anchor line OUTSIDE a code block, is noise and dropped. Inside a code block
 * (from the shared excluded-range scanner) nothing is noise — whitespace and
 * an anchor-shaped line are the example's content, so adding or removing one
 * there IS a change. Until 2.0.0 the filter switched off entirely as soon as
 * either side held a fence anywhere.
 */
export function computeLineDiff(a: string, b: string, kind: SectionFileKind = 'md'): LineDiff {
  const aCode = codeLines(a, kind);
  const bCode = codeLines(b, kind);
  const lines: Array<LineDiffLine & { inCode: boolean }> = [];
  let ai = 0;
  let bi = 0;
  for (const part of diffLines(a, b)) {
    const op: LineDiffLine['op'] = part.added ? 'added' : part.removed ? 'removed' : 'keep';
    const partLines = part.value.split('\n');
    // diffLines emits trailing empty string for blocks that end in \n; drop it.
    if (partLines.length > 0 && partLines[partLines.length - 1] === '') partLines.pop();
    for (const content of partLines) {
      const inCode = op === 'added' ? bCode.has(bi) : aCode.has(ai);
      lines.push({ op, content, inCode });
      if (op !== 'added') ai++;
      if (op !== 'removed') bi++;
    }
  }
  return {
    lines: lines
      .filter((l) => {
        if (l.op === 'keep' || l.inCode) return true;
        if (l.content.trim() === '') return false;
        if (ANCHOR_LINE_RE.test(l.content)) return false;
        return true;
      })
      .map(({ op, content }) => ({ op, content })),
  };
}

/** 0-based indexes of the lines of `text` that lie inside a fenced code block. */
function codeLines(text: string, kind: SectionFileKind): Set<number> {
  const out = new Set<number>();
  if (!text.includes('```') && !text.includes('~~~')) return out;
  for (const r of parseSections(text, kind, { frontmatter: false }).excludedRanges) {
    if (r.kind !== 'fence') continue;
    for (let l = r.range.start; l <= r.range.end; l++) out.add(l - 1);
  }
  return out;
}

/** Live anchors (outside code) in document order — informational, see `FileSnapshotData.anchors`. */
export function extractAnchorsInOrder(content: string, kind: SectionFileKind = 'md'): string[] {
  return liveAnchorValues(content, kind);
}

/** One side of a diff, split by the shared section parser. */
interface DiffEntry {
  key: SectionKey;
  /** The OWN body (for the preamble: its whole range). */
  content: string;
  /** Position among the sections of its side (document order). */
  position: number;
}

interface DiffSide {
  preamble: DiffEntry | null;
  /** First occurrence of each anchor — the indexer's collision rule. */
  anchored: Map<string, DiffEntry>;
  /** Headings without an anchor (and duplicate-anchor losers): no identity. */
  unanchored: DiffEntry[];
  /** Anchored entries in document order. */
  order: string[];
}

function splitSide(content: string, kind: SectionFileKind): DiffSide {
  const parsed = parseSections(content, kind);
  const lines = content.split('\n');
  const side: DiffSide = { preamble: null, anchored: new Map(), unanchored: [], order: [] };
  if (parsed.preamble) {
    side.preamble = {
      key: { kind: 'preamble', anchor: PREAMBLE_KEY, heading: null, level: null, parent: null, headingPath: [] },
      content: sliceLines(lines, parsed.preamble.range),
      position: -1,
    };
  }
  for (const sec of parsed.sections) {
    const parent = sec.parent === null ? null : parsed.sections[sec.parent]!.anchor;
    const owns = sec.anchor !== null && !side.anchored.has(sec.anchor);
    const entry: DiffEntry = {
      key: {
        kind: 'section',
        anchor: owns ? sec.anchor : null,
        heading: sec.heading,
        level: sec.level,
        parent,
        headingPath: headingPathOf(parsed, sec),
      },
      content: sliceLines(lines, { start: sec.headingLine + 1, end: sec.ownEndLine }),
      position: sec.position,
    };
    if (owns) {
      side.anchored.set(sec.anchor!, entry);
      side.order.push(sec.anchor!);
    } else {
      side.unanchored.push(entry);
    }
  }
  return side;
}

function allEntries(side: DiffSide): DiffEntry[] {
  const out: DiffEntry[] = side.preamble ? [side.preamble] : [];
  const secs = [...side.anchored.values(), ...side.unanchored].sort((x, y) => x.position - y.position);
  return [...out, ...secs];
}

const asSection = (e: DiffEntry): FileSection => ({ ...e.key, content: e.content });

/** Longest common subsequence of two anchor orders — what did NOT move. */
function lcs(a: readonly string[], b: readonly string[]): Set<string> {
  const n = a.length;
  const m = b.length;
  // The common case — nothing moved — needs no O(n·m) table.
  if (n === m && a.every((x, k) => x === b[k])) return new Set(a);
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const keep = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keep.add(a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return keep;
}

export class FileSerializer {
  readonly version = FILE_SERIALIZER_VERSION;

  constructor(private pages: PagesService) {}

  /**
   * Read the file from disk and produce a deterministic, byte-faithful
   * snapshot. Reads `content` byte-for-byte (preserves BOM, line endings).
   */
  async snapshot(relPath: string): Promise<FileSnapshotData> {
    const abs = path.join(this.pages.root, relPath);
    const raw = await fs.readFile(abs, 'utf-8');
    return this.snapshotFromContent(relPath, raw);
  }

  /** Build snapshot from already-read content (used for delete tombstones). */
  snapshotFromContent(relPath: string, content: string): FileSnapshotData {
    const parsed = matter(content);
    const anchors = extractAnchorsInOrder(content, fileKindOf(relPath));
    const xml_refs = parseXmlTags(content).map((t) => ({
      tagType: t.kind,
      attributes: t.attrs,
      position: t.start,
    }));
    return {
      path: relPath,
      content,
      frontmatter: (parsed.data ?? {}) as Record<string, unknown>,
      anchors,
      xml_refs,
    };
  }

  /**
   * Section-level diff (variant C in M17 decyzja 10), on the shared section
   * parser (2.0.0):
   *  - entries are keyed by anchor, plus `~preamble` for text above the first
   *    heading (a page without headings diffs as its preamble);
   *  - each entry compares the section's OWN body: a change inside a subsection
   *    is that subsection's entry only, never its parent's;
   *  - `modified_sections` — own body changed after the noise filter, or the
   *    heading (text or level) changed;
   *  - a heading WITHOUT an anchor has no identity: it never pairs across sides,
   *    so a changed one is a `removed` + `added` pair, never `modified`/`moved`;
   *  - `moved_sections` — anchored sections outside the LCS of the two orders;
   *    the preamble never moves.
   * `FileSnapshotData.anchors` is never read: `content` is re-parsed.
   */
  diff(
    a: FileSnapshotData | null,
    b: FileSnapshotData | null,
    relPath: string,
    rootId: string = this.pages.rootId,
  ): FileDiff {
    const kind = fileKindOf(relPath);
    const empty: Pick<FileDiff, 'added_sections' | 'removed_sections' | 'modified_sections' | 'moved_sections'> = {
      added_sections: [],
      removed_sections: [],
      modified_sections: [],
      moved_sections: [],
    };
    if (a == null && b == null) {
      return { rootId, path: relPath, op: 'noop', ...empty, frontmatter_diff: null, xml_refs_diff: null };
    }
    if (a == null) {
      return {
        rootId,
        path: relPath,
        op: 'created',
        ...empty,
        added_sections: allEntries(splitSide(b!.content, kind)).map(asSection),
        frontmatter_diff: frontmatterDiff({}, b!.frontmatter),
        xml_refs_diff: { added: b!.xml_refs, removed: [] },
      };
    }
    if (b == null) {
      return {
        rootId,
        path: relPath,
        op: 'deleted',
        ...empty,
        removed_sections: allEntries(splitSide(a.content, kind)).map(asSection),
        frontmatter_diff: frontmatterDiff(a.frontmatter, {}),
        xml_refs_diff: { added: [], removed: a.xml_refs },
      };
    }

    const aSide = splitSide(a.content, kind);
    const bSide = splitSide(b.content, kind);
    const added: FileSection[] = [];
    const removed: FileSection[] = [];
    const modified: ModifiedSection[] = [];
    const moved: FileDiff['moved_sections'] = [];

    const compare = (x: DiffEntry, y: DiffEntry) => {
      const lineDiff = computeLineDiff(x.content, y.content, kind);
      const bodyChanged = lineDiff.lines.some((l) => l.op !== 'keep');
      const headingChanged = x.key.heading !== y.key.heading || x.key.level !== y.key.level;
      if (bodyChanged || headingChanged) modified.push({ ...y.key, line_diff: lineDiff });
    };

    // The preamble — a full element, outside move detection.
    if (aSide.preamble && bSide.preamble) compare(aSide.preamble, bSide.preamble);
    else if (bSide.preamble) added.push(asSection(bSide.preamble));
    else if (aSide.preamble) removed.push(asSection(aSide.preamble));

    for (const [anchor, y] of bSide.anchored) {
      const x = aSide.anchored.get(anchor);
      if (!x) added.push(asSection(y));
      else compare(x, y);
    }
    for (const [anchor, x] of aSide.anchored) {
      if (!bSide.anchored.has(anchor)) removed.push(asSection(x));
    }

    /**
     * Unanchored headings: no identity, so nothing pairs. An entry identical on
     * both sides (same heading, level and own body — as a multiset) is simply
     * unchanged and reported nowhere; anything else is removed on `a` and added
     * on `b`, identified by its heading text.
     */
    const sig = (e: DiffEntry) => `${e.key.level}|${e.key.heading}|${e.content}`;
    const unmatchedB = [...bSide.unanchored];
    for (const x of aSide.unanchored) {
      const k = unmatchedB.findIndex((y) => sig(y) === sig(x));
      if (k >= 0) unmatchedB.splice(k, 1);
      else removed.push(asSection(x));
    }
    for (const y of unmatchedB) added.push(asSection(y));

    const common = (order: string[], other: DiffSide) => order.filter((an) => other.anchored.has(an));
    const aOrder = common(aSide.order, bSide);
    const bOrder = common(bSide.order, aSide);
    const stayed = lcs(aOrder, bOrder);
    for (const anchor of bOrder) {
      if (stayed.has(anchor)) continue;
      moved.push({
        anchor,
        from_position: aSide.anchored.get(anchor)!.position,
        to_position: bSide.anchored.get(anchor)!.position,
      });
    }

    const fmDiff = frontmatterDiff(a.frontmatter, b.frontmatter);
    const xmlDiff = xmlRefsDiff(a.xml_refs, b.xml_refs);

    const anyChange =
      added.length || removed.length || modified.length || moved.length || fmDiff || xmlDiff;

    return {
      rootId,
      path: relPath,
      op: anyChange ? 'modified' : 'noop',
      added_sections: added,
      removed_sections: removed,
      modified_sections: modified,
      moved_sections: moved,
      frontmatter_diff: fmDiff,
      xml_refs_diff: xmlDiff,
    };
  }
}

function frontmatterDiff(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): FrontmatterDiff | null {
  const added: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};
  const changed: Array<{ key: string; from: unknown; to: unknown }> = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const inA = key in a;
    const inB = key in b;
    if (!inA && inB) added[key] = b[key];
    else if (inA && !inB) removed[key] = a[key];
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      changed.push({ key, from: a[key], to: b[key] });
    }
  }
  if (Object.keys(added).length === 0 && Object.keys(removed).length === 0 && changed.length === 0) {
    return null;
  }
  return { added, removed, changed };
}

function xmlRefsDiff(a: FileXmlRef[], b: FileXmlRef[]): XmlRefsDiff | null {
  // Identity = (tagType, canonical attrs). Position is EXCLUDED on purpose:
  // inserting text above a tag shifts its byte offset, which would otherwise
  // surface as a fake `removed @ oldPos + added @ newPos` pair for a tag that
  // didn't actually change. Identical-attribute occurrences are deduped by
  // multiset count (not by Set membership), so duplicates are tracked correctly:
  // 2 occurrences before, 1 after → exactly 1 reported as removed.
  const keyOf = (r: FileXmlRef) =>
    `${r.tagType}|${JSON.stringify(canonicalAttrs(r.attributes))}`;
  const groupBy = (refs: FileXmlRef[]): Map<string, FileXmlRef[]> => {
    const m = new Map<string, FileXmlRef[]>();
    for (const r of refs) {
      const k = keyOf(r);
      const bucket = m.get(k);
      if (bucket) bucket.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const aByKey = groupBy(a);
  const bByKey = groupBy(b);
  const added: FileXmlRef[] = [];
  const removed: FileXmlRef[] = [];
  const allKeys = new Set([...aByKey.keys(), ...bByKey.keys()]);
  for (const k of allKeys) {
    const aArr = aByKey.get(k) ?? [];
    const bArr = bByKey.get(k) ?? [];
    if (bArr.length > aArr.length) {
      added.push(...bArr.slice(aArr.length));
    } else if (aArr.length > bArr.length) {
      removed.push(...aArr.slice(bArr.length));
    }
    // Equal counts: same identity present in both → no event emitted, regardless
    // of position changes. Pure positional shifts are not changes.
  }
  if (added.length === 0 && removed.length === 0) return null;
  return { added, removed };
}

function canonicalAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(attrs).sort()) out[key] = attrs[key]!;
  return out;
}
