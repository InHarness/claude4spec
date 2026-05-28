/**
 * PageSerializer — M02 stays out of L9 plugin host (M17 decyzja 1).
 * Lives outside `EntitySerializer` registry; provides parallel
 * snapshot/restore/diff for markdown pages.
 *
 * Snapshot shape — `PageSnapshotData` per `db-m17-snapshots.md` (`dbm17shp01`).
 * Diff variant C (M17 decyzja 10): section-level operations + mandatory
 * `line_diff` inside each `section_modified` + `frontmatter_diff` /
 * `xml_refs_diff` side-channels.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { diffLines } from 'diff';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import { parseXmlTagsExcludingCode } from '../../shared/xml-tags.js';
import type { PagesService } from './pages.js';

export const PAGE_SERIALIZER_VERSION = '1.1.0';

const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE, 'g');
const ANCHOR_LINE_RE = new RegExp(`^\\s*${ANCHOR_PATTERN_SOURCE}\\s*$`);
const ANCHOR_INLINE_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const CODE_FENCE_RE = /^\s*```/m;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export interface PageXmlRef {
  tagType: string;
  attributes: Record<string, string>;
  position: number;
}

export interface PageSnapshotData {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  anchors: string[];
  xml_refs: PageXmlRef[];
}

export interface PageSection {
  anchor: string;
  heading: string;
  level: number;
  content: string;
  position: number;
}

export interface FrontmatterDiff {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  changed: Array<{ key: string; from: unknown; to: unknown }>;
}

export interface XmlRefsDiff {
  added: PageXmlRef[];
  removed: PageXmlRef[];
}

/** Per-line diff inside a modified section (M17 decyzja 10 wariant C). */
export interface LineDiffLine {
  op: 'keep' | 'added' | 'removed';
  content: string;
}

export interface LineDiff {
  lines: LineDiffLine[];
}

export interface ModifiedSection {
  anchor: string;
  heading: string;
  level: number;
  /** Mandatory in variant C — line-level diff of section body. */
  line_diff: LineDiff;
}

export interface PageDiff {
  path: string;
  op: 'created' | 'deleted' | 'modified' | 'noop';
  added_sections: PageSection[];
  removed_sections: PageSection[];
  modified_sections: ModifiedSection[];
  moved_sections: Array<{ anchor: string; from_position: number; to_position: number }>;
  frontmatter_diff: FrontmatterDiff | null;
  xml_refs_diff: XmlRefsDiff | null;
}

/**
 * Compute line-level diff between two strings using Myers algorithm
 * (via `diff` npm). Returns a flat list of keep/added/removed lines
 * preserving order. Trailing newlines are normalized so identical
 * content with/without final \n compares equal.
 */
export function computeLineDiff(a: string, b: string): LineDiff {
  const lines: LineDiffLine[] = [];
  const parts = diffLines(a, b);
  for (const part of parts) {
    const op: LineDiffLine['op'] = part.added ? 'added' : part.removed ? 'removed' : 'keep';
    const partLines = part.value.split('\n');
    // diffLines emits trailing empty string for blocks that end in \n; drop it.
    if (partLines.length > 0 && partLines[partLines.length - 1] === '') partLines.pop();
    for (const content of partLines) {
      lines.push({ op, content });
    }
  }
  // Inside fenced code blocks (```), whitespace and HTML comments can be
  // semantically meaningful (YAML, Python, indent-DSL, markdown-in-markdown).
  // Skip noise filtering entirely when either side contains a code fence.
  if (CODE_FENCE_RE.test(a) || CODE_FENCE_RE.test(b)) {
    return { lines };
  }
  const filtered = lines.filter((l) => {
    if (l.op === 'keep') return true;
    if (l.content.trim() === '') return false;
    if (ANCHOR_LINE_RE.test(l.content)) return false;
    return true;
  });
  return { lines: filtered };
}

/** Extract anchors in document order. */
export function extractAnchorsInOrder(content: string): string[] {
  const out: string[] = [];
  ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANCHOR_RE.exec(content)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

export class PageSerializer {
  readonly version = PAGE_SERIALIZER_VERSION;

  constructor(private pages: PagesService) {}

  /**
   * Read the file from disk and produce a deterministic, byte-faithful
   * snapshot. Reads `content` byte-for-byte (preserves BOM, line endings).
   */
  async snapshot(relPath: string): Promise<PageSnapshotData> {
    const abs = path.join(this.pages.root, relPath);
    const raw = await fs.readFile(abs, 'utf-8');
    return this.snapshotFromContent(relPath, raw);
  }

  /** Build snapshot from already-read content (used for delete tombstones). */
  snapshotFromContent(relPath: string, content: string): PageSnapshotData {
    const parsed = matter(content);
    const anchors = extractAnchorsInOrder(content);
    const xml_refs = parseXmlTagsExcludingCode(content).map((t) => ({
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
   * Section-level diff (variant C in M17 decyzja 10). Sections keyed by
   * 8-char anchor (`<!-- anchor: ... -->`). Reorder without content change
   * → moved_section. Heading edited → counted as modified (heading is part
   * of section content in our parser). Each `modified` section carries a
   * mandatory `line_diff` computed via Myers diff over section bodies.
   */
  diff(a: PageSnapshotData | null, b: PageSnapshotData | null, relPath: string): PageDiff {
    const empty: Pick<PageDiff, 'added_sections' | 'removed_sections' | 'modified_sections' | 'moved_sections'> = {
      added_sections: [],
      removed_sections: [],
      modified_sections: [],
      moved_sections: [],
    };
    if (a == null && b == null) {
      return { path: relPath, op: 'noop', ...empty, frontmatter_diff: null, xml_refs_diff: null };
    }
    if (a == null) {
      const sections = parseSections(b!.content);
      return {
        path: relPath,
        op: 'created',
        added_sections: sections,
        removed_sections: [],
        modified_sections: [],
        moved_sections: [],
        frontmatter_diff: frontmatterDiff({}, b!.frontmatter),
        xml_refs_diff: { added: b!.xml_refs, removed: [] },
      };
    }
    if (b == null) {
      const sections = parseSections(a.content);
      return {
        path: relPath,
        op: 'deleted',
        added_sections: [],
        removed_sections: sections,
        modified_sections: [],
        moved_sections: [],
        frontmatter_diff: frontmatterDiff(a.frontmatter, {}),
        xml_refs_diff: { added: [], removed: a.xml_refs },
      };
    }

    const aSec = parseSections(a.content);
    const bSec = parseSections(b.content);
    const aMap = new Map(aSec.map((s) => [s.anchor, s]));
    const bMap = new Map(bSec.map((s) => [s.anchor, s]));

    const added: PageSection[] = [];
    const removed: PageSection[] = [];
    const modified: ModifiedSection[] = [];
    const moved: Array<{ anchor: string; from_position: number; to_position: number }> = [];

    for (const [anchor, sec] of bMap) {
      if (!aMap.has(anchor)) added.push(sec);
    }
    for (const [anchor, sec] of aMap) {
      const other = bMap.get(anchor);
      if (!other) {
        removed.push(sec);
        continue;
      }
      if (sec.content === other.content && sec.heading === other.heading) {
        if (sec.position !== other.position) {
          moved.push({ anchor, from_position: sec.position, to_position: other.position });
        }
        continue;
      }
      const lineDiff = computeLineDiff(sec.content, other.content);
      const hasContentChange = lineDiff.lines.some((l) => l.op !== 'keep');
      const headingChanged = sec.heading !== other.heading;
      if (hasContentChange || headingChanged) {
        modified.push({
          anchor,
          heading: other.heading,
          level: other.level,
          line_diff: lineDiff,
        });
      } else if (sec.position !== other.position) {
        moved.push({ anchor, from_position: sec.position, to_position: other.position });
      }
    }

    const fmDiff = frontmatterDiff(a.frontmatter, b.frontmatter);
    const xmlDiff = xmlRefsDiff(a.xml_refs, b.xml_refs);

    const anyChange =
      added.length || removed.length || modified.length || moved.length || fmDiff || xmlDiff;

    return {
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

/**
 * Split markdown content into sections keyed by 8-char anchor. A section spans
 * from a heading (with anchor comment) to the next heading of equal or higher
 * level. Content without an anchor is grouped under an implicit root section
 * keyed by `__root__`.
 */
export function parseSections(content: string): PageSection[] {
  const lines = content.split('\n');
  const sections: PageSection[] = [];

  let position = 0;
  let currentAnchor: string | null = null;
  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentAnchor) {
      sections.push({
        anchor: currentAnchor,
        heading: currentHeading,
        level: currentLevel,
        content: currentLines.join('\n'),
        position: position++,
      });
    } else if (currentLines.length > 0 && currentLines.some((l) => l.trim().length > 0)) {
      sections.push({
        anchor: '__root__',
        heading: '',
        level: 0,
        content: currentLines.join('\n'),
        position: position++,
      });
    }
    currentAnchor = null;
    currentHeading = '';
    currentLevel = 0;
    currentLines = [];
  };

  let pendingAnchor: string | null = null;
  let pendingBlanks: string[] = [];

  // Orphan a pending anchor + its buffered blank lines into the current section
  // (i.e. anchor never met a heading — fall back to treating it as inline content).
  const orphanPending = () => {
    if (pendingAnchor !== null) {
      currentLines.push(`<!-- anchor: ${pendingAnchor} -->`);
      pendingAnchor = null;
    }
    if (pendingBlanks.length > 0) {
      currentLines.push(...pendingBlanks);
      pendingBlanks = [];
    }
  };

  for (const line of lines) {
    const anchorMatch = line.match(ANCHOR_INLINE_RE);
    if (anchorMatch && anchorMatch[1]) {
      // A second anchor before any heading appeared — orphan the previous one
      // (matches historical behavior for the rare `anchor\nanchor\nheading` case)
      // before adopting the new pending anchor.
      orphanPending();
      pendingAnchor = anchorMatch[1];
      continue;
    }
    // Blank line between anchor and heading: buffer it, keep the anchor pending.
    // Canonical indexer layout is `anchor\n\nheading`, so this is the common case.
    if (pendingAnchor !== null && line.trim() === '') {
      pendingBlanks.push(line);
      continue;
    }
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch && pendingAnchor !== null) {
      flush();
      currentAnchor = pendingAnchor;
      currentLevel = headingMatch[1]!.length;
      currentHeading = headingMatch[2]!.trim();
      // Buffered blanks (if any) become leading whitespace of the new section,
      // so concatenating section contents reconstructs the on-disk body modulo
      // the consumed anchor line itself.
      currentLines = pendingBlanks.length > 0 ? [...pendingBlanks, line] : [line];
      pendingAnchor = null;
      pendingBlanks = [];
      continue;
    }
    // Non-blank, non-heading, non-anchor line: anchor (if any) never found its
    // heading — orphan it together with any buffered blanks, then push current line.
    orphanPending();
    currentLines.push(line);
  }
  // File ended with a dangling anchor (and maybe blanks) — orphan into trailing content.
  orphanPending();
  flush();
  return sections;
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

function xmlRefsDiff(a: PageXmlRef[], b: PageXmlRef[]): XmlRefsDiff | null {
  // Identity = (tagType, canonical attrs). Position is EXCLUDED on purpose:
  // inserting text above a tag shifts its byte offset, which would otherwise
  // surface as a fake `removed @ oldPos + added @ newPos` pair for a tag that
  // didn't actually change. Identical-attribute occurrences are deduped by
  // multiset count (not by Set membership), so duplicates are tracked correctly:
  // 2 occurrences before, 1 after → exactly 1 reported as removed.
  const keyOf = (r: PageXmlRef) =>
    `${r.tagType}|${JSON.stringify(canonicalAttrs(r.attributes))}`;
  const groupBy = (refs: PageXmlRef[]): Map<string, PageXmlRef[]> => {
    const m = new Map<string, PageXmlRef[]>();
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
  const added: PageXmlRef[] = [];
  const removed: PageXmlRef[] = [];
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
