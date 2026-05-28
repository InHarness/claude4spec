import type { EntityType, ReferenceHit } from '../../shared/entities.js';
import {
  parseXmlTagsExcludingCode,
  serializeXmlTag,
  type XmlTag,
} from '../../shared/xml-tags.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';

export class ReferencesService {
  constructor(private pages: PagesService, private watcher: PagesWatcher) {}

  async findReferences(type: EntityType, slug: string): Promise<ReferenceHit[]> {
    const hits: ReferenceHit[] = [];
    await this.walkPages(async (relPath, body) => {
      for (const tag of parseXmlTagsExcludingCode(body)) {
        if (tagMatchesEntity(tag, type, slug)) {
          hits.push({ pagePath: relPath, tagType: tag.kind, line: tag.line, raw: tag.raw });
        }
      }
    });
    return hits;
  }

  async findPagesReferencingSlugs(type: EntityType, slugs: Set<string>): Promise<Set<string>> {
    const out = new Set<string>();
    await this.walkPages(async (relPath, body) => {
      for (const tag of parseXmlTagsExcludingCode(body)) {
        if (tag.attrs.type && tag.attrs.type !== type && tag.kind !== 'tagged_list_mixed') continue;
        const hasSlug = entitySlugsInTag(tag).some((s) => slugs.has(s));
        if (hasSlug) out.add(relPath);
      }
    });
    return out;
  }

  async propagateSlugChange(
    type: EntityType,
    oldSlug: string,
    newSlug: string
  ): Promise<{ changed: string[] }> {
    if (oldSlug === newSlug) return { changed: [] };
    const changed: string[] = [];
    const backups = new Map<string, string>();

    await this.walkPages(async (relPath, body) => {
      const rewritten = rewriteTagsInBody(body, (tag) => {
        if (tag.attrs.type !== type) return null;
        if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
          if (tag.attrs.slug !== oldSlug) return null;
          return { ...tag.attrs, slug: newSlug };
        }
        if (tag.kind === 'element_list') {
          const slugs = splitCsv(tag.attrs.slugs);
          if (!slugs.includes(oldSlug)) return null;
          return { ...tag.attrs, slugs: slugs.map((s) => (s === oldSlug ? newSlug : s)).join(',') };
        }
        return null;
      });
      if (rewritten !== body) {
        backups.set(relPath, body);
      }
    });

    try {
      for (const [relPath, originalBody] of backups) {
        const current = await this.pages.read(relPath);
        const newBody = rewriteTagsInBody(current.body, (tag) => {
          if (tag.attrs.type !== type) return null;
          if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
            if (tag.attrs.slug !== oldSlug) return null;
            return { ...tag.attrs, slug: newSlug };
          }
          if (tag.kind === 'element_list') {
            const slugs = splitCsv(tag.attrs.slugs);
            if (!slugs.includes(oldSlug)) return null;
            return { ...tag.attrs, slugs: slugs.map((s) => (s === oldSlug ? newSlug : s)).join(',') };
          }
          return null;
        });
        if (newBody !== current.body) {
          this.watcher.suppress(relPath);
          await this.pages.write(relPath, { frontmatter: current.frontmatter, body: newBody });
          changed.push(relPath);
        }
        // swallow the unused original backup — we only need it if we need to rollback
        void originalBody;
      }
    } catch (err) {
      for (const [relPath, originalBody] of backups) {
        if (!changed.includes(relPath)) continue;
        const current = await this.pages.read(relPath);
        this.watcher.suppress(relPath);
        await this.pages.write(relPath, { frontmatter: current.frontmatter, body: originalBody });
      }
      throw err;
    }

    return { changed };
  }

  async propagateTagSlugChange(
    oldTagSlug: string,
    newTagSlug: string
  ): Promise<{ changed: string[] }> {
    if (oldTagSlug === newTagSlug) return { changed: [] };
    const changed: string[] = [];

    await this.walkPages(async (relPath) => {
      const current = await this.pages.read(relPath);
      const newBody = rewriteTagsInBody(current.body, (tag) => {
        if (tag.kind !== 'tagged_list' && tag.kind !== 'tagged_list_mixed') return null;
        const tags = splitCsv(tag.attrs.tags);
        if (!tags.includes(oldTagSlug)) return null;
        return { ...tag.attrs, tags: tags.map((t) => (t === oldTagSlug ? newTagSlug : t)).join(',') };
      });
      if (newBody !== current.body) {
        this.watcher.suppress(relPath);
        await this.pages.write(relPath, { frontmatter: current.frontmatter, body: newBody });
        changed.push(relPath);
      }
    });

    return { changed };
  }

  private async walkPages(
    visit: (relPath: string, body: string) => Promise<void>
  ): Promise<void> {
    const files = await this.pages.listMarkdownFiles();
    for (const rel of files) {
      const page = await this.pages.read(rel);
      await visit(rel, page.body);
    }
  }
}

function tagMatchesEntity(tag: XmlTag, type: EntityType, slug: string): boolean {
  if (tag.kind === 'tagged_list_mixed') return false;
  if (tag.attrs.type !== type) return false;
  if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
    return tag.attrs.slug === slug;
  }
  if (tag.kind === 'element_list') {
    return splitCsv(tag.attrs.slugs).includes(slug);
  }
  return false;
}

function entitySlugsInTag(tag: XmlTag): string[] {
  if (tag.kind === 'inline_mention' || tag.kind === 'single_element') {
    return tag.attrs.slug ? [tag.attrs.slug] : [];
  }
  if (tag.kind === 'element_list') return splitCsv(tag.attrs.slugs);
  return [];
}

function splitCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function rewriteTagsInBody(
  body: string,
  mutate: (tag: XmlTag) => Record<string, string> | null
): string {
  const tags = parseXmlTagsExcludingCode(body);
  if (tags.length === 0) return body;
  let out = '';
  let cursor = 0;
  for (const tag of tags) {
    const nextAttrs = mutate(tag);
    out += body.slice(cursor, tag.start);
    if (nextAttrs) {
      out += serializeXmlTag(tag.kind, nextAttrs);
    } else {
      out += body.slice(tag.start, tag.end);
    }
    cursor = tag.end;
  }
  out += body.slice(cursor);
  return out;
}


