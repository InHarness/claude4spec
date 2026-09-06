import { useEffect, useState } from 'react';
import type { FrontendModule } from '@c4s/plugin-runtime';
import {
  MODULE_DEPENDENCY_DISPLAY_ORDER,
  MODULE_DEPENDENCY_LABEL,
  MODULE_DEPENDENCY_LABEL_PLURAL,
  MODULE_DEPENDENCY_PATH_PREFIX,
  MODULE_DEPENDENCY_TYPE,
} from '../identity.js';
import { moduleDependencyData, moduleDependencySlugPattern } from '../schema.js';
import { ModuleDependencyCard } from './card.js';
import { ModuleDependencyChip } from './chip.js';
import { ModuleDependencyOverlay } from './overlay.js';
import { ModuleDependencyRow } from './row.js';
import { fetchModuleDependency, listModuleDependenciesByTags, type ModuleDependency } from './types.js';

/**
 * The frontend module of a type that is HIDDEN and LISTABLE at the same time —
 * two independent properties that are easy to read as one.
 *
 * HIDDEN is what the omissions mean, and the host reads them rather than a flag:
 * no `sidebarTab`, so the rail filters the type out; no `routes` and no
 * `detailPanel`, so there is no list page, no detail page and nowhere for a chip
 * click to navigate — which is why `renderOverlay` is then REQUIRED. A global
 * list of every edge in the specification would answer no question anyone has.
 *
 * LISTABLE is `renderRow`, and nothing else. The tagged-list component delegates
 * each row to it and needs no detail route to do so — the two properties are
 * independent, and this is the one place this type diverges from every hidden
 * type before it. `diagram`, `code-snippet` and `spreadsheet` are all hidden and
 * all three omit `renderRow` on purpose, so their tagged lists fall through to
 * the host's `NotListable` placeholder. This one lists.
 *
 * No `editorExtensions` and no `stateSlice`: edges are created in a workflow
 * step, after the prose is written, not while writing it. So the type
 * contributes no slash command and no popover — the generic `/tagged` embed is
 * the whole authoring surface it needs.
 */
export const moduleDependencyFrontendModule: FrontendModule = {
  type: MODULE_DEPENDENCY_TYPE,
  data: moduleDependencyData,
  slugPattern: moduleDependencySlugPattern,
  payloadVersion: 1,
  label: MODULE_DEPENDENCY_LABEL,
  labelPlural: MODULE_DEPENDENCY_LABEL_PLURAL,
  displayOrder: MODULE_DEPENDENCY_DISPLAY_ORDER,
  pathPrefix: MODULE_DEPENDENCY_PATH_PREFIX,

  renderRow: ModuleDependencyRow as FrontendModule['renderRow'],
  renderChip: ModuleDependencyChip,
  renderCard: ModuleDependencyCard,
  renderOverlay: ModuleDependencyOverlay as FrontendModule['renderOverlay'],

  /**
   * The whole record, because there is no cheaper read: no field is
   * `contentBearing`, so a single-entity GET already carries `needs` in full.
   */
  useGetBySlug: (slug: string | null) => {
    const [data, setData] = useState<ModuleDependency | null | undefined>(undefined);
    useEffect(() => {
      if (!slug) {
        setData(null);
        return;
      }
      let live = true;
      setData(undefined);
      void fetchModuleDependency(slug).then((next) => {
        if (live) setData(next);
      });
      return () => {
        live = false;
      };
    }, [slug]);
    /*
     * `data` PASSED THROUGH, never coalesced to `null`.
     *
     * The slot's three states are distinct and the host reads all three: both
     * resolvers gate their skeleton on `isLoading && data === undefined`, so
     * collapsing `undefined` to `null` skips the skeleton and hands the chip and
     * card an `entity` of `null` — which this type renders as the red "broken"
     * state. Every load would flash a broken reference before resolving.
     */
    return { data, isLoading: data === undefined };
  },

  /**
   * OUTGOING edges only, which is the same statement as "the entity carries the
   * tag of its `dependent`". A module's incoming edges are a `provider` filter
   * and never appear in an embed — see `types.ts`.
   */
  listByTags: ({ tags, filter }) => listModuleDependenciesByTags(tags, filter),
};
