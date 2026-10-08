/**
 * 2.1.9 — the read-only collaborators of ONE project context, shaped for the
 * M19 embed expansion (`src/core/references/expand-embeds.ts`).
 *
 * The expansion is serverless and receives everything through this object, so
 * "expand in the context of project P" means: build this from P's discovery
 * core, P's section index and P's page-link index. Nothing here reaches a
 * second project, a file, or a live-server dependency.
 *
 *  - entity reader by slugs with a projection → `getEntitiesAll` (`select: []`
 *    is the identity skeleton — slug, title, tags, href; no `select` is the full
 *    record);
 *  - listing by tags → `listEntitiesAll` with `tags` + `tagFilter`, the same
 *    listing a `<tagged_list/>` renders from; a mixed list asks every active type;
 *  - section index → the heading text by anchor;
 *  - page index → the page links of a text (M14's parser) and the title of the
 *    page a link resolves to.
 */

import type { ExpansionContext, ExpansionEntity, ExpansionPageLink, ExpansionSource } from '../../core/references/types.js';
import { parseLinks } from '../services/pages-link-indexer.js';
import { getEntitiesAll, listEntitiesAll } from './index.js';
import type { DiscoveryCore } from './types.js';

export interface ExpansionContextDeps {
  discovery: DiscoveryCore;
  sections: { getByAnchor(anchor: string): { headingText: string } | null };
  links: {
    resolve(candidate: string, sourcePath: string, sourceRootId: string | null): { rootId: string; path: string } | null;
    getFileMeta(rootId: string, relPath: string): { title: string } | undefined;
  };
}

export function createExpansionContext(deps: ExpansionContextDeps): ExpansionContext {
  return {
    readEntities(type, slugs, projection) {
      const { results } = getEntitiesAll(deps.discovery, {
        type,
        slugs,
        ...(projection === 'empty' ? { select: [] } : {}),
      });
      return results.map((r) => ({
        slug: r.slug,
        entity: r.entity === null ? null : ({ ...(r.entity as Record<string, unknown>), slug: r.slug } as ExpansionEntity),
      }));
    },

    listByTags({ type, tags, filter }) {
      const types = type ? [type] : deps.discovery.describeTypes().types.map((t) => t.type);
      return types.flatMap((t) =>
        listEntitiesAll(deps.discovery, { type: t, tags, tagFilter: filter }).map((row) => ({
          type: t,
          slug: row.slug,
          title: row.title,
        })),
      );
    },

    sectionHeading(anchor) {
      return deps.sections.getByAnchor(anchor)?.headingText ?? null;
    },

    findPageLinks(text) {
      const lineOffsets = [0];
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineOffsets.push(i + 1);
      return parseLinks(text).candidates.map((c): ExpansionPageLink => {
        const start = (lineOffsets[c.line - 1] ?? 0) + c.col;
        return {
          syntax: c.syntax,
          raw: c.rawToken,
          start,
          end: start + c.rawToken.length,
          targetPath: c.targetPath,
          ...(c.anchor !== undefined ? { anchor: c.anchor } : {}),
        };
      });
    },

    pageTitle(link: ExpansionPageLink, source?: ExpansionSource) {
      const hit = deps.links.resolve(link.targetPath, source?.path ?? '', source?.rootId ?? null);
      if (!hit) return null;
      return deps.links.getFileMeta(hit.rootId, hit.path)?.title ?? null;
    },
  };
}
