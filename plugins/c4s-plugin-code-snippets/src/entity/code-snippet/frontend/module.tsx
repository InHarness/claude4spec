import { useEffect, useState } from 'react';
import type { FrontendModule } from '@c4s/plugin-runtime';
import {
  CODE_SNIPPET_DISPLAY_ORDER,
  CODE_SNIPPET_LABEL,
  CODE_SNIPPET_LABEL_PLURAL,
  CODE_SNIPPET_PATH_PREFIX,
  CODE_SNIPPET_TYPE,
} from '../../../identity.js';
import { codeSnippetData, codeSnippetSlugPattern } from '../schema.js';
import { CodeSnippetCard } from './card.js';
import { CodeSnippetChip } from './chip.js';
import { CodeSnippetFullscreen } from './fullscreen.js';
import { fetchCodeSnippet, type CodeSnippet } from './hooks.js';

/**
 * The frontend module of a HIDDEN type.
 *
 * "Hidden" is what the OMISSIONS mean, and the host reads them rather than a
 * flag: no `sidebarTab`, so the rail filters the type out; no `routes` and no
 * `detailPanel`, so there is no list page, no detail page, and nowhere for a
 * chip click to navigate — which is why `renderOverlay` is required instead.
 *
 * `renderRow` IS ALSO OMITTED, and that omission is load-bearing in its own
 * right: without it `<element_list type="code-snippet"/>` and
 * `<tagged_list type="code-snippet"/>` fall through to the host's `NotListable`
 * placeholder. They are unsupported embedding paths BY CONTRACT rather than by
 * accident — a snippet is cited, one at a time, in the place its shape is being
 * discussed; a list of them is a list of things nobody asked to see together.
 *
 * No `editorExtensions` either. The type registers no XML tag and no Tiptap
 * node: it rides the generic M19 reference tags exactly as `diagram` and
 * `spreadsheet` do, so the dispatcher allowlist stays at seven names. The
 * `/code-snippet` slash command is declared in `capabilities/commands.ts`, on the
 * manifest, and deliberately NOT here — see the note there for what happens when
 * a trigger is declared in both places.
 */
export const codeSnippetFrontendModule: FrontendModule = {
  type: CODE_SNIPPET_TYPE,
  data: codeSnippetData,
  slugPattern: codeSnippetSlugPattern,
  payloadVersion: 1,
  label: CODE_SNIPPET_LABEL,
  labelPlural: CODE_SNIPPET_LABEL_PLURAL,
  displayOrder: CODE_SNIPPET_DISPLAY_ORDER,
  pathPrefix: CODE_SNIPPET_PATH_PREFIX,

  renderChip: CodeSnippetChip,
  renderCard: CodeSnippetCard,
  renderOverlay: CodeSnippetFullscreen,

  /**
   * The whole record, because for this type there is no cheaper read: `code` is
   * not `contentBearing`, so a single-entity GET already carries it. Handing back
   * a trimmed shape here would mean the card fetching a second time for the body
   * it could have had.
   */
  useGetBySlug: (slug: string | null) => {
    const [data, setData] = useState<CodeSnippet | null | undefined>(undefined);
    useEffect(() => {
      if (!slug) {
        setData(null);
        return;
      }
      let live = true;
      setData(undefined);
      void fetchCodeSnippet(slug).then((next) => {
        if (live) setData(next);
      });
      return () => {
        live = false;
      };
    }, [slug]);
    return { data: data ?? null, isLoading: data === undefined };
  },

  /**
   * Always empty, and that is the same decision as the missing `renderRow`
   * rather than a second one: tag-driven listing is not a supported embedding
   * path for this type, so there is nothing for a tagged list to render.
   */
  listByTags: async () => [],
};
