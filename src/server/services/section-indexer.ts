import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';
import type Database from 'better-sqlite3';
import { parseXmlTags, parseXmlTagsExcludingCode } from '../../shared/xml-tags.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { WsGateway } from '../ws/gateway.js';
import { pluginHost } from '../core/plugin-host/host.js';

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

export class SectionIndexerService {
  private debounceMs = 300;
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private db: Database.Database,
    private pages: PagesService,
    private watcher: PagesWatcher,
    private ws: WsGateway,
  ) {}

  schedulePage(relPath: string): void {
    const prev = this.pending.get(relPath);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.pending.delete(relPath);
      this.indexPage(relPath).catch((err) => {
        console.error(`[section-indexer] failed to index ${relPath}:`, err);
      });
    }, this.debounceMs);
    this.pending.set(relPath, timer);
  }

  async handleUnlink(relPath: string): Promise<void> {
    const prev = this.pending.get(relPath);
    if (prev) {
      clearTimeout(prev);
      this.pending.delete(relPath);
    }
    const existing = this.db
      .prepare('SELECT anchor FROM section_index WHERE page_path = ?')
      .all(relPath) as Array<{ anchor: string }>;
    if (existing.length === 0) return;
    const anchors = existing.map((r) => r.anchor);
    const tx = this.db.transaction(() => {
      for (const anchor of anchors) this.removeSectionIndex(anchor);
    });
    tx();
  }

  private removeSectionIndex(anchor: string): void {
    this.db.prepare('DELETE FROM section_entity_link WHERE anchor = ?').run(anchor);
    this.db.prepare('DELETE FROM section_index WHERE anchor = ?').run(anchor);
  }

  async indexAll(): Promise<void> {
    const files = await this.pages.listMarkdownFiles();
    for (const rel of files) {
      await this.indexPage(rel);
    }
  }

  async indexPage(relPath: string): Promise<void> {
    let page;
    try {
      page = await this.pages.read(relPath);
    } catch {
      return;
    }
    let body = page.body;

    const lines = body.split('\n');
    const headings = parseHeadings(lines);
    let bodyChanged = false;

    for (const h of headings) {
      if (h.anchor === null) {
        const newAnchor = nanoid8();
        lines.splice(h.lineIndex, 0, `<!-- anchor: ${newAnchor} -->`);
        shiftHeadingLines(headings, h.lineIndex, 1);
        h.anchor = newAnchor;
        h.anchorLineIndex = h.lineIndex - 1;
        bodyChanged = true;
      }
    }

    if (bodyChanged) {
      body = lines.join('\n');
      this.watcher.suppress(relPath);
      await this.pages.write(relPath, { frontmatter: page.frontmatter, body });
    }

    const sections = buildSections(lines, headings);

    const priorRows = this.db
      .prepare(
        'SELECT anchor, content_hash FROM section_index WHERE page_path = ?'
      )
      .all(relPath) as Array<{ anchor: string; content_hash: string }>;
    const prior = new Map(priorRows.map((r) => [r.anchor, r.content_hash] as const));
    const currentAnchors = new Set(sections.map((s) => s.anchor));

    const deletedAnchors: string[] = [];
    for (const anchor of prior.keys()) {
      if (!currentAnchors.has(anchor)) deletedAnchors.push(anchor);
    }

    const tx = this.db.transaction(() => {
      const upsertStmt = this.db.prepare(
        `INSERT INTO section_index
            (anchor, page_path, heading_path, heading_slug, heading_level,
             heading_text, content_hash, line_start, line_end, paragraph_count,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(anchor) DO UPDATE SET
            page_path = excluded.page_path,
            heading_path = excluded.heading_path,
            heading_slug = excluded.heading_slug,
            heading_level = excluded.heading_level,
            heading_text = excluded.heading_text,
            content_hash = excluded.content_hash,
            line_start = excluded.line_start,
            line_end = excluded.line_end,
            paragraph_count = excluded.paragraph_count,
            updated_at = datetime('now')`
      );
      for (const s of sections) {
        upsertStmt.run(
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

      const anchorsInFile = sections.map((s) => s.anchor);
      if (anchorsInFile.length) {
        const placeholders = anchorsInFile.map(() => '?').join(',');
        this.db
          .prepare(`DELETE FROM section_entity_link WHERE anchor IN (${placeholders})`)
          .run(...anchorsInFile);

        const linkStmt = this.db.prepare(
          `INSERT OR IGNORE INTO section_entity_link (anchor, entity_type, entity_id, relation)
               VALUES (?, ?, ?, 'uses')`
        );
        for (const s of sections) {
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
              const entityId = this.resolveEntityId(type, slug);
              if (entityId != null) linkStmt.run(s.anchor, type, entityId);
            }
          }
        }
      }
    });
    tx();

    this.ws.broadcast({
      kind: 'section:indexed',
      pagePath: relPath,
      anchors: sections.map((s) => s.anchor),
    });
  }

  private resolveEntityId(type: string, slug: string): number | null {
    return pluginHost.resolveEntityId(type, slug);
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
  for (let idx = 0; idx < headings.length; idx++) {
    const h = headings[idx]!;
    if (!h.anchor) continue;
    while (stack.length && stack[stack.length - 1]!.level >= h.level) stack.pop();
    const headingPath = [...stack.map((x) => x.text), h.text].join('/');
    const headingSlug = slugifyHeading(h.text);
    stack.push(h);

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

