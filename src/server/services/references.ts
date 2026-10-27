import type Database from 'better-sqlite3';
import type { EntityType, ReferenceHit, Tag, TagUpdateInput } from '../../shared/entities.js';
import type { PageContent } from '../../shared/types.js';
import {
  parseXmlTags,
  serializeXmlTag,
  type XmlTag,
} from '../../shared/xml-tags.js';
import type { MarkdownFileStore } from './markdown-file-store.js';
import type { SelfWriteMarker } from '../fs/sources.js';
import type { EntityStore } from './entity-store.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { type RawEntityType } from '../discovery/raw-entity-reader.js';
import { findReferences as findReferencesCore } from '../../core/references/index.js';
import { runMultiFileOperation, type MultiFileOperation } from '../fs/multi-file-operation.js';
import type { TagsService } from './tags.js';
import type { PagesSource, ReferencePage } from '../../core/references/index.js';

/**
 * Adapt a server-side PagesService into the serverless `PagesSource` the
 * references core (M19) consumes. The core never imports PagesService directly.
 */
export function pagesServiceSource(pages: MarkdownFileStore): PagesSource {
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
   * 0.1.96 multiroot: the service is bound to the roots in the reference graph
   * (2.1.8: the roots whose KIND carries `references = yes` — their markdown
   * entries, `.md`/`.mdx`), keyed by `rootId`. Every
   * walk/propagate iterates that subset keyed `(rootId, path)`; writes go through
   * the matching root's `PagesService` + M40 write handle (markOrigin before write).
   * Entity-file propagation (setPluginHost) is root-agnostic and unchanged.
   */
  constructor(
    private roots: Map<string, MarkdownFileStore>,
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
    await this.walkPages(async (_rootId, relPath, page) => {
      for (const tag of parseXmlTags(page.body)) {
        if (tag.attrs.type && tag.attrs.type !== type && tag.kind !== 'tagged_list_mixed') continue;
        const hasSlug = entitySlugsInTag(tag).some((s) => slugs.has(s));
        if (hasSlug) out.add(relPath);
      }
    });
    return out;
  }

  /**
   * M19 `8n46mdrz` / M29 `m29ren001` — an entity's slug change, propagated.
   *
   * 2.1.57 — the propagation is ONE multi-file operation (M42 `gg7sxih6`): every
   * page rewrite is a step of it, so their version rows carry one
   * `operation_id`, and a write that fails puts the pages already rewritten back
   * and fails the operation. Those two rules live in the primitive; this method
   * no longer keeps backups or a restore loop of its own.
   *
   * The entity-file phase (`propagateInEntityFiles`) runs inside the same
   * operation, after every page has been written. Its writes are derived copies
   * of rows the listeners have just committed (M29 file-last), so nothing is
   * written after them that could fail and call for their undo.
   */
  async propagateSlugChange(
    type: EntityType,
    oldSlug: string,
    newSlug: string
  ): Promise<{ changed: string[] }> {
    if (oldSlug === newSlug) return { changed: [] };

    const mutate = (tag: XmlTag): Record<string, string> | null => {
      // 0.2.15 — every entity reference spells its type out in `type=`, so the
      // rewriter needs one gate, not one gate plus a per-tag special case.
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

    return await runMultiFileOperation(async (op) => {
      const changed = await this.rewritePages(op, mutate);
      // M29: also rewrite the slug inside other committed entity files.
      this.propagateInEntityFiles(type, oldSlug, newSlug);
      return { changed };
    });
  }

  /**
   * M18 `91vuvf2u` — the page half of a tag slug rename: `tags="…"` of
   * `<tagged_list>` / `<tagged_list_mixed>` in every reference root. One
   * multi-file operation (M42 `gg7sxih6`); called inside {@link updateTag}'s, it
   * joins that one.
   */
  async propagateTagSlugChange(
    oldTagSlug: string,
    newTagSlug: string
  ): Promise<{ changed: string[] }> {
    if (oldTagSlug === newTagSlug) return { changed: [] };
    return await runMultiFileOperation(async (op) => ({
      changed: await this.rewritePages(op, (tag) => {
        if (tag.kind !== 'tagged_list' && tag.kind !== 'tagged_list_mixed') return null;
        const tags = splitCsv(tag.attrs.tags);
        if (!tags.includes(oldTagSlug)) return null;
        return { ...tag.attrs, tags: tags.map((t) => (t === oldTagSlug ? newTagSlug : t)).join(',') };
      }),
    }));
  }

  /**
   * M18 `91vuvf2u` / `m18acc00` — `update_tag` (REST and MCP alike). A change of
   * `name` that changes the slug is ONE multi-file operation (M42 `gg7sxih6`)
   * over the three places the slug lives: the pages, `tags.json` and the
   * `tags[]` of the entity files.
   *
   * The pages go first. `tags.json` and the entity files are written by
   * `TagsService.update` file-last, from the index rows it has just committed
   * (M29), so they cannot be put back by bytes without leaving the index behind
   * them; written last, they are never the files a later failure has to undo. A
   * refusal of the update itself (`NOT_FOUND`, `VALIDATION`, `SLUG_CONFLICT`) is
   * settled by `slugAfterUpdate` before the operation starts, so it reaches the
   * caller with its own code and no page has been touched.
   */
  async updateTag(tags: TagsService, slug: string, input: TagUpdateInput): Promise<Tag> {
    const newSlug = tags.slugAfterUpdate(slug, input);
    if (newSlug === slug) return tags.update(slug, input);
    return await runMultiFileOperation(async () => {
      await this.propagateTagSlugChange(slug, newSlug);
      return tags.update(slug, input);
    });
  }

  /**
   * Rewrite every reference-root page `mutate` changes, each as a step of `op`
   * — its own write through the primitive, its own chain on its own path.
   */
  private async rewritePages(
    op: MultiFileOperation,
    mutate: (tag: XmlTag) => Record<string, string> | null,
  ): Promise<string[]> {
    const changed: string[] = [];
    await this.walkPages(async (rootId, relPath, page) => {
      const newBody = rewriteTagsInBody(page.body, mutate);
      if (newBody === page.body) return;
      const pages = this.roots.get(rootId);
      if (!pages) return;
      /**
       * 0.2.76 — a cascading write-back: it writes a DIFFERENT file from the
       * one whose rename started this, so it takes the normal route through
       * the primitive and gets its own conflict check, its own commit and its
       * own full chain on its own path. This token is the fallback for a root
       * with no record store (the hand-rolled rigs); where there is one, the
       * primitive issues its own immediately before the write and this is
       * simply replaced.
       */
      this.watcherFor(rootId)?.suppress(relPath);
      await pages.write(relPath, { frontmatter: page.frontmatter, body: newBody }, op);
      changed.push(relPath);
    });
    return changed;
  }

  private async walkPages(
    visit: (rootId: string, relPath: string, page: PageContent) => Promise<void>
  ): Promise<void> {
    for (const [rootId, pages] of this.roots) {
      const files = await pages.listMarkdownFiles();
      for (const rel of files) {
        const page = await pages.read(rel);
        await visit(rootId, rel, page);
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
  const tags = parseXmlTags(body);
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


