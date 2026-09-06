/**
 * Render slot `renderRow` — a row of an EMBEDDED list, which for this type is
 * the ONLY way an edge is ever seen: a module's `## Zależności` section is one
 * `<tagged_list type="module-dependency" tags="mNN"/>` and a sentence of prose.
 *
 * DECLARING THIS SLOT IS WHAT MAKES THE TYPE LISTABLE. Hidden-ness comes from
 * omitting `routes` and `detailPanel`; listability is a separate question, and
 * `renderRow` is its whole answer — the tagged-list component delegates each row
 * here and never needs a detail route. `code-snippet` is the same kind of hidden
 * type and omits this slot, which is exactly why its tagged lists fall through
 * to the host's `NotListable` placeholder.
 *
 * PURE REACT: the host injects an already-resolved, non-null `entity`, so the
 * row never fetches and owns no broken state — a broken slug inside an embedded
 * list is drawn by the host as a chip.
 *
 * ORDER IS `createdAt` ASCENDING, and it is not this component's to change. A
 * hand-ordered dependency table migrated into entities loses its authored order
 * permanently; that loss was accepted when the type was chosen over the table.
 */

import type { FC } from 'react';
import { EntityListRow } from '@c4s/plugin-runtime/ui';
import type { Tag } from '@c4s/plugin-runtime/ui';
import type { EntityRowProps } from '@c4s/plugin-runtime';
import { DependencySentence } from './sentence.js';
import type { ModuleDependency } from './types.js';

/** Embedded rows carry no tag chips — the host embed passes no tag context. */
const EMPTY_TAG_LOOKUP = new Map<string, Tag>();

export const ModuleDependencyRow: FC<EntityRowProps<ModuleDependency>> = ({
  slug,
  entity,
  active,
  onOpen,
}) => (
  /*
   * The wrapper exists to carry the identifiers — `EntityListRow` renders a
   * fixed prop set and forwards nothing it does not declare, so there is no way
   * to hang them on the row itself.
   */
  <div data-testid="module-dependency-row" data-slug={slug}>
    <EntityListRow
      /*
       * `onOpen` PASSED THROUGH, not defaulted to a no-op.
       *
       * `EntityListRow` renders a `<button>` when it gets an `onClick` and a
       * plain `<div>` when it does not. A no-op default would therefore make an
       * unopenable row look and behave like a button that does nothing — and
       * `onOpen` is absent exactly when the host could not build a handler,
       * i.e. when the type resolves to nothing. Passing it through lets the row
       * be honestly inert instead.
       */
      {...(onOpen ? { onClick: onOpen } : {})}
      style={active ? { background: 'var(--c-accent-soft)' } : undefined}
      tags={[]}
      tagLookup={EMPTY_TAG_LOOKUP}
      align="start"
    >
      <DependencySentence dependent={entity.dependent} provider={entity.provider} />
      {/*
        `needs` in full rather than truncated: it is capped at 400 characters by
        the schema precisely so it always fits, and a dependency whose reason is
        elided is a row that tells the reader nothing they did not already see in
        the two badges above it.
      */}
      <div className="text-[12.5px] mt-1" style={{ color: 'var(--c-muted)' }}>
        {entity.needs}
      </div>
    </EntityListRow>
  </div>
);
