import type Database from 'better-sqlite3';
import type { EntityType, ReferenceHit } from '../../shared/entities.js';
import {
  parseXmlTagsExcludingCode,
  serializeXmlTag,
  type XmlTag,
} from '../../shared/xml-tags.js';
import type { PagesService } from './pages.js';
import type { SelfWriteMarker } from '../fs/sources.js';
import type { EntityStore } from './entity-store.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { isRawEntityType, type RawEntityType } from '../discovery/raw-entity-reader.js';
import { findReferences as findReferencesCore } from '../../core/references/index.js';
import type { PagesSource, ReferencePage } from '../../core/references/index.js';

/**
 * Adapt a server-side PagesService into the serverless `PagesSource` the
 * references core (M19) consumes. The core never imports PagesService directly.
 */
export function pagesServiceSource(pages: PagesService): PagesSource {
  return {
    async listPages(): Promise<ReferencePage[]> {
      const files = await pages.listMarkdownFiles();
      const out: ReferencePage[] = [];
      for (const rel of files) {
        const page = await pages.read(rel);
        // M39: `rootId` is required on a reference page — the service knows
        // which root it serves, and dropping it here made every hit from a user
        // root claim to come from the built-in one.
        out.push({ rootId: pages.rootId, path: rel, body: page.body });
      }
      return out;
    },
  };
}

export class ReferencesService {
  /**
   * 0.1.96 multiroot: the service is bound to the REFERENCE-VALIDATED page roots
   * (config.roots filtered by `referenceValidated`), keyed by `rootId`. Every
   * walk/propagate iterates that subset keyed `(rootId, path)`; writes go through
   * the matching root's `PagesService` + M40 write handle (markOrigin before write).
   * Entity-file propagation (setPluginHost) is root-agnostic and unchanged.
   */
  constructor(
    private roots: Map<string, PagesService>,
    private watchers: Map<string, SelfWriteMarker>,
  ) {}

  private watcherFor(rootId: string): SelfWriteMarker | undefined {
    return this.watchers.get(rootId);
  }

  /**
   * 0.2.2: the project host, so a rename can be fanned out to the modules that
   * registered a rename listener. Wired post-construction — the host is mounted
   * after this service is built.
   *
   * This replaces the former `setEntityDeps(db, store)`: propagating a rename
   * into other entity FILES no longer needs the host's own db handle or store,
   * because the host no longer knows which tables or files embed a slug. Each
   * listener gets those from its own MountContext.
   */
  private host: ProjectPluginHost | null = null;
  setPluginHost(host: ProjectPluginHost): void {
    this.host = host;
  }

  /**
   * M29 (m29ren001): after an entity rename, rewrite the slug inside OTHER
   * committed entity files whose snapshots embed it.
   *
   * 0.2.2 moved three hardcoded branches — dto rename repersists endpoints,
   * design-system rename repoints ui_view.design_system_slug, any rename
   * repoints ac.verifies — out of this method and into a per-module hook, so the
   * host would stop naming another module's table. 2.0.0 removes the hook too:
   * the `ref` flag on `data.schema` says which fields hold a reference, so the
   * host generates one listener per module (`synthesizeMount`) over a single
   * rewrite (`db/ref-rewrite.ts`). This method still just fans the event out —
   * what changed is who wrote the listeners, not how they are called.
   *
   * Files-only; page XML refs are handled by the caller above. Handlers are
   * expected to be idempotent; a throwing one is logged and skipped, exactly as
   * the per-type branches swallowed their own failures.
   */
  private propagateInEntityFiles(type: EntityType, oldSlug: string, newSlug: string): void {
    for (const listener of this.host?.listRenameListeners() ?? []) {
      try {
        listener({ type, oldSlug, newSlug });
      } catch (err) {
        console.warn(
          `[references] rename listener failed for ${type} ${oldSlug} -> ${newSlug}: ${String(err)}`,
        );
      }
    }
  }

  /**
   * Aggregate the reference-validated roots into a single serverless `PagesSource`
   * (M19) so the core walks every root's markdown once.
   */
  private aggregateSource(): PagesSource {
    const roots = this.roots;
    return {
      async listPages(): Promise<ReferencePage[]> {
        const out: ReferencePage[] = [];
        for (const [rootId, pages] of roots) {
          const files = await pages.listMarkdownFiles();
          for (const rel of files) {
            const page = await pages.read(rel);
            out.push({ rootId, path: rel, body: page.body });
          }
        }
        return out;
      },
    };
  }

  async findReferences(type: EntityType, slug: string): Promise<ReferenceHit[]> {
    // Delegate to the serverless core (M19); static-only (no includeTagMatches),
    // so every superset hit carries `raw`. Project back onto ReferenceHit.
    const hits = await findReferencesCore({ pages: this.aggregateSource() }, type, slug);
    return hits.map((h) => ({
      rootId: h.rootId,
      pagePath: h.pagePath,
      tagType: h.tagType,
      line: h.line,
      raw: h.raw ?? '',
    }));
  }

  async findPagesReferencingSlugs(type: EntityType, slugs: Set<string>): Promise<Set<string>> {
    const out = new Set<string>();
    await this.walkPages(async (_rootId, relPath, body) => {
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
    // Keyed by (rootId, relPath): a bare relPath is ambiguous across roots.
    const backups = new Map<string, { rootId: string; relPath: string; body: string }>();
    const changedKeys = new Set<string>();
    const key = (rootId: string, relPath: string) => `${rootId} ${relPath}`;

    const mutate = (tag: XmlTag): Record<string, string> | null => {
      if (tag.kind === 'diagram') {
        if (type !== 'diagram' || tag.attrs.slug !== oldSlug) return null;
        return { ...tag.attrs, slug: newSlug };
      }
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
    };

    await this.walkPages(async (rootId, relPath, body) => {
      const rewritten = rewriteTagsInBody(body, mutate);
      if (rewritten !== body) {
        backups.set(key(rootId, relPath), { rootId, relPath, body });
      }
    });

    try {
      for (const { rootId, relPath } of backups.values()) {
        const pages = this.roots.get(rootId);
        if (!pages) continue;
        const current = await pages.read(relPath);
        const newBody = rewriteTagsInBody(current.body, mutate);
        if (newBody !== current.body) {
          this.watcherFor(rootId)?.suppress(relPath);
          await pages.write(relPath, { frontmatter: current.frontmatter, body: newBody });
          changed.push(relPath);
          changedKeys.add(key(rootId, relPath));
        }
      }
    } catch (err) {
      for (const { rootId, relPath, body: originalBody } of backups.values()) {
        if (!changedKeys.has(key(rootId, relPath))) continue;
        const pages = this.roots.get(rootId);
        if (!pages) continue;
        const current = await pages.read(relPath);
        this.watcherFor(rootId)?.suppress(relPath);
        await pages.write(relPath, { frontmatter: current.frontmatter, body: originalBody });
      }
      throw err;
    }

    // M29: also rewrite the slug inside other committed entity files.
    this.propagateInEntityFiles(type, oldSlug, newSlug);

    return { changed };
  }

  async propagateTagSlugChange(
    oldTagSlug: string,
    newTagSlug: string
  ): Promise<{ changed: string[] }> {
    if (oldTagSlug === newTagSlug) return { changed: [] };
    const changed: string[] = [];

    await this.walkPages(async (rootId, relPath, body) => {
      const newBody = rewriteTagsInBody(body, (tag) => {
        if (tag.kind !== 'tagged_list' && tag.kind !== 'tagged_list_mixed') return null;
        const tags = splitCsv(tag.attrs.tags);
        if (!tags.includes(oldTagSlug)) return null;
        return { ...tag.attrs, tags: tags.map((t) => (t === oldTagSlug ? newTagSlug : t)).join(',') };
      });
      if (newBody !== body) {
        const pages = this.roots.get(rootId);
        if (!pages) return;
        const current = await pages.read(relPath);
        this.watcherFor(rootId)?.suppress(relPath);
        await pages.write(relPath, { frontmatter: current.frontmatter, body: newBody });
        changed.push(relPath);
      }
    });

    return { changed };
  }

  private async walkPages(
    visit: (rootId: string, relPath: string, body: string) => Promise<void>
  ): Promise<void> {
    for (const [rootId, pages] of this.roots) {
      const files = await pages.listMarkdownFiles();
      for (const rel of files) {
        const page = await pages.read(rel);
        await visit(rootId, rel, page.body);
      }
    }
  }
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


