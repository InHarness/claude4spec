import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';
import type Database from 'better-sqlite3';
import { parseXmlTags, parseXmlTagsExcludingCode } from '../../shared/xml-tags.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

// Generator stays strict 8 (per M06 spec `15u7sazr` — auto-inject contract).
const nanoid8 = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

interface ParsedHeading {
  level: number;
  text: string;
  lineIndex: number;
  anchor: string | null;
  anchorLineIndex: number | null;
}

interface SectionInfo {
  anchor: string;
  heading: ParsedHeading;
  headingPath: string;
  headingSlug: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  contentHash: string;
  paragraphCount: number;
}

/** 0.1.96: one section-indexed root — its PagesService plus the watcher whose
 * captures we suppress when auto-injecting anchors. */
export interface SectionIndexRoot {
  pages: PagesService;
  watcher: PagesWatcher;
}

export class SectionIndexerService {
  private debounceMs = 300;
  /** Keyed by `${rootId}:${relPath}` so the same path in two roots debounces
   * independently. */
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private db: Database.Database,
    /** rootId → {pages, watcher} for every SECTION-INDEXED root (filter
     * config.roots by `sectionIndexed`, always includes the built-in 'pages'). */
    private roots: Map<string, SectionIndexRoot>,
    private ws: WsEmitter,
    private host: ProjectPluginHost,
  ) {}

  private key(rootId: string, relPath: string): string {
    return `${rootId}:${relPath}`;
  }

  schedulePage(rootId: string, relPath: string): void {
    const k = this.key(rootId, relPath);
    const prev = this.pending.get(k);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.pending.delete(k);
      this.indexPage(rootId, relPath).catch((err) => {
        console.error(`[section-indexer] failed to index ${rootId}:${relPath}:`, err);
      });
    }, this.debounceMs);
    this.pending.set(k, timer);
  }

  async handleUnlink(rootId: string, relPath: string): Promise<void> {
    const k = this.key(rootId, relPath);
    const prev = this.pending.get(k);
    if (prev) {
      clearTimeout(prev);
      this.pending.delete(k);
    }
    const existing = this.db
      .prepare('SELECT anchor FROM section_index WHERE rootId = ? AND page_path = ?')
      .all(rootId, relPath) as Array<{ anchor: string }>;
    if (existing.length === 0) return;
    const anchors = existing.map((r) => r.anchor);
    const tx = this.db.transaction(() => {
      for (const anchor of anchors) this.removeSectionIndex(anchor);
    });
    tx();
  }

  /**
   * An anchor is the identity of a section — `get_sections({ anchors })`,
   * `list_sections({ by: "anchor" })` and `<section_ref anchor="…"/>` all assume
   * it names exactly one. The generator used to mint one blind and hand it
   * straight to an upsert keyed on `anchor`, so a collision did not raise: it
   * OVERWROTE the other section's row and made it unaddressable.
   *
   * Occupancy is checked PROJECT-WIDE, not per file, because `<section_ref/>`
   * carries no page path — there is no scope in which a per-file anchor would
   * resolve. 36^8 makes a collision vanishingly unlikely; the point of the probe
   * is that "unlikely" is not the same guarantee as "checked".
   */
  private freshAnchor(taken: ReadonlySet<string>): string {
    const occupied = this.db.prepare('SELECT 1 FROM section_index WHERE anchor = ?');
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = nanoid8();
      if (taken.has(candidate)) continue;
      if (occupied.get(candidate)) continue;
      return candidate;
    }
    // Eight straight collisions in a 2.8e12 space is not bad luck, it is a
    // broken generator. Failing loudly beats minting a duplicate.
    throw new Error('[section-indexer] could not mint a free anchor in 8 attempts');
  }

  private removeSectionIndex(anchor: string): void {
    // anchor is globally unique — deleting by anchor is root-agnostic.
    this.db.prepare('DELETE FROM section_entity_link WHERE anchor = ?').run(anchor);
    this.db.prepare('DELETE FROM section_index WHERE anchor = ?').run(anchor);
  }

  async indexAll(): Promise<void> {
    for (const [rootId, { pages }] of this.roots) {
      const files = await pages.listMarkdownFiles();
      for (const rel of files) {
        await this.indexPage(rootId, rel);
      }
    }
  }

  async indexPage(rootId: string, relPath: string): Promise<void> {
    const root = this.roots.get(rootId);
    if (!root) return;
    const { pages, watcher } = root;
    let page;
    try {
      page = await pages.read(relPath);
    } catch {
      return;
    }
    let body = page.body;

    const lines = body.split('\n');
    const headings = parseHeadings(lines);
    let bodyChanged = false;

    // Every anchor already spoken for, so a freshly minted one cannot land on
    // top of an existing section. Seeded with what THIS file already carries
    // (the file may not be in the index yet, or may be mid-rewrite) and grown
    // as we mint — two headings in one pass must not collide with each other.
    const taken = new Set(headings.map((h) => h.anchor).filter((a): a is string => a !== null));

    for (const h of headings) {
      if (h.anchor === null) {
        const newAnchor = this.freshAnchor(taken);
        taken.add(newAnchor);
        lines.splice(h.lineIndex, 0, `<!-- anchor: ${newAnchor} -->`);
        shiftHeadingLines(headings, h.lineIndex, 1);
        h.anchor = newAnchor;
        h.anchorLineIndex = h.lineIndex - 1;
        bodyChanged = true;
      }
    }

    if (bodyChanged) {
      body = lines.join('\n');
      watcher.suppress(relPath);
      await pages.write(relPath, { frontmatter: page.frontmatter, body });
    }

    const sections = buildSections(lines, headings);

    const priorRows = this.db
      .prepare(
        'SELECT anchor, content_hash FROM section_index WHERE rootId = ? AND page_path = ?'
      )
      .all(rootId, relPath) as Array<{ anchor: string; content_hash: string }>;
    const prior = new Map(priorRows.map((r) => [r.anchor, r.content_hash] as const));
    const currentAnchors = new Set(sections.map((s) => s.anchor));

    const deletedAnchors: string[] = [];
    for (const anchor of prior.keys()) {
      if (!currentAnchors.has(anchor)) deletedAnchors.push(anchor);
    }

    const tx = this.db.transaction(() => {
      /**
       * Deterministic rule, half two — across pages.
       *
       * `section_index.anchor` is UNIQUE, so a duplicate never raised here: the
       * upsert quietly took the row from whichever page was scanned last, which
       * made the winner a function of directory order. The WHERE makes the
       * winner a function of the DATA instead: lowest (rootId, page_path) owns
       * the anchor, and the same page always updates itself so an ordinary
       * re-index (heading moved, body edited) still lands.
       *
       * Consequence, documented in the tool descriptions: with a live duplicate,
       * `get_sections` serves the lowest-sorting location, every time, on every
       * machine. `check_consistency` reports the collision so it gets fixed
       * rather than silently tolerated.
       */
      const upsertStmt = this.db.prepare(
        `INSERT INTO section_index
            (rootId, anchor, page_path, heading_path, heading_slug, heading_level,
             heading_text, content_hash, line_start, line_end, paragraph_count,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(anchor) DO UPDATE SET
            rootId = excluded.rootId,
            page_path = excluded.page_path,
            heading_path = excluded.heading_path,
            heading_slug = excluded.heading_slug,
            heading_level = excluded.heading_level,
            heading_text = excluded.heading_text,
            content_hash = excluded.content_hash,
            line_start = excluded.line_start,
            line_end = excluded.line_end,
            paragraph_count = excluded.paragraph_count,
            updated_at = datetime('now')
          WHERE excluded.rootId < section_index.rootId
             OR (excluded.rootId = section_index.rootId
                 AND excluded.page_path <= section_index.page_path)`
      );
      for (const s of sections) {
        upsertStmt.run(
          rootId,
          s.anchor,
          relPath,
          s.headingPath,
          s.headingSlug,
          s.heading.level,
          s.heading.text,
          s.contentHash,
          s.lineStart,
          s.lineEnd,
          s.paragraphCount
        );
      }

      if (deletedAnchors.length) {
        for (const anchor of deletedAnchors) this.removeSectionIndex(anchor);
      }

      /**
       * The anchors this page actually OWNS after the upsert, read back rather
       * than assumed. On a collision the row stays with the lowest-sorting
       * location, and the loser must not go on to rewrite the winner's links —
       * that would put the deterministic rule back at the mercy of scan order
       * one layer down, where it is harder to see.
       */
      const owned = new Set(
        (
          this.db
            .prepare('SELECT anchor FROM section_index WHERE rootId = ? AND page_path = ?')
            .all(rootId, relPath) as Array<{ anchor: string }>
        ).map((r) => r.anchor),
      );
      const ownedSections = sections.filter((s) => owned.has(s.anchor));

      const anchorsInFile = ownedSections.map((s) => s.anchor);
      if (anchorsInFile.length) {
        // Delete this page's links by (rootId, anchor-set). anchor alone is
        // globally unique, so rootId is a belt-and-suspenders scope match.
        const placeholders = anchorsInFile.map(() => '?').join(',');
        this.db
          .prepare(
            `DELETE FROM section_entity_link WHERE rootId = ? AND anchor IN (${placeholders})`
          )
          .run(rootId, ...anchorsInFile);

        const linkStmt = this.db.prepare(
          `INSERT OR IGNORE INTO section_entity_link (rootId, anchor, entity_type, entity_slug, relation)
               VALUES (?, ?, ?, ?, 'uses')`
        );
        for (const s of ownedSections) {
          const xmlTags = parseXmlTagsExcludingCode(s.content);
          const seen = new Set<string>();
          for (const tag of xmlTags) {
            const type = tag.attrs.type;
            if (!type) continue;
            const slugs = extractSlugsFromTag(tag);
            for (const slug of slugs) {
              const key = `${type}|${slug}`;
              if (seen.has(key)) continue;
              seen.add(key);
              // M29: link by slug (sole identity); only persist for entities
              // that actually exist, mirroring the prior id-resolver guard.
              if (this.host.entityExists(type, slug)) linkStmt.run(rootId, s.anchor, type, slug);
            }
          }
        }
      }
    });
    tx();

    this.ws.broadcast({
      kind: 'section:indexed',
      rootId,
      pagePath: relPath,
      anchors: sections.map((s) => s.anchor),
    });
  }
}

function parseHeadings(lines: string[]): ParsedHeading[] {
  const out: ParsedHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = HEADING_RE.exec(line);
    if (!m) continue;
    const level = (m[1] ?? '').length;
    const text = (m[2] ?? '').trim();
    let anchor: string | null = null;
    let anchorLineIndex: number | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const above = (lines[j] ?? '').trim();
      if (above === '') continue;
      const am = ANCHOR_RE.exec(above);
      if (am) {
        anchor = am[1] ?? null;
        anchorLineIndex = j;
      }
      break;
    }
    out.push({ level, text, lineIndex: i, anchor, anchorLineIndex });
  }
  return out;
}

function shiftHeadingLines(headings: ParsedHeading[], fromIndex: number, delta: number): void {
  for (const h of headings) {
    if (h.lineIndex >= fromIndex) h.lineIndex += delta;
    if (h.anchorLineIndex !== null && h.anchorLineIndex >= fromIndex) {
      h.anchorLineIndex += delta;
    }
  }
}

function buildSections(lines: string[], headings: ParsedHeading[]): SectionInfo[] {
  const sections: SectionInfo[] = [];
  const stack: ParsedHeading[] = [];
  // Hand-authored anchors are unpoliced, so the same value CAN appear twice in
  // one file. Deterministic rule, half one: within a page the FIRST occurrence
  // (lowest line) owns the anchor and the rest are not indexed. Never "whichever
  // the upsert wrote last".
  const claimed = new Set<string>();
  for (let idx = 0; idx < headings.length; idx++) {
    const h = headings[idx]!;
    if (!h.anchor) continue;
    while (stack.length && stack[stack.length - 1]!.level >= h.level) stack.pop();
    const headingPath = [...stack.map((x) => x.text), h.text].join('/');
    const headingSlug = slugifyHeading(h.text);
    stack.push(h);
    // Skipped AFTER the stack is maintained: the losing heading still shapes the
    // heading path of everything nested under it, it just does not get a row.
    if (claimed.has(h.anchor)) continue;
    claimed.add(h.anchor);

    let endLine = lines.length;
    for (let j = idx + 1; j < headings.length; j++) {
      if (headings[j]!.level <= h.level) {
        endLine = headings[j]!.anchorLineIndex ?? headings[j]!.lineIndex;
        break;
      }
    }
    const startLine = h.lineIndex;
    const sectionLines = lines.slice(startLine, endLine);
    const rawBody = sectionLines.slice(1).join('\n');
    const normalized = normalizeContent(rawBody);
    const contentHash = crypto.createHash('sha256').update(normalized).digest('hex');
    const paragraphCount = countParagraphs(rawBody);
    sections.push({
      anchor: h.anchor,
      heading: h,
      headingPath,
      headingSlug,
      lineStart: startLine + 1,
      lineEnd: endLine,
      content: rawBody,
      contentHash,
      paragraphCount,
    });
  }
  return sections;
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function normalizeContent(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\w[^>]*\/?>(?:[\s\S]*?<\/\w+>)?/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function countParagraphs(content: string): number {
  const blocks = content.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  return blocks.length;
}

function extractSlugsFromTag(tag: ReturnType<typeof parseXmlTags>[number]): string[] {
  if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
    return tag.attrs.slug ? [tag.attrs.slug] : [];
  }
  if (tag.kind === 'element_list') {
    return (tag.attrs.slugs ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

