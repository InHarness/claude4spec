/**
 * Render slot `renderCard` — one edge embedded on its own via
 * `<single_element type="module-dependency" slug="…"/>`.
 *
 * The card is the row's argument spelled out: the same sentence, then `needs`
 * under a labelled field rather than as a subtitle. `FieldGrid` / `FieldRow` are
 * the two STABLE components in the kit, which is why the card's structure rests
 * on them and only its accents on the experimental ones.
 *
 * A `null` entity means the host resolved the slug to nothing. The type is still
 * known — otherwise the host would draw its own unknown-type card instead of
 * mounting this — so the broken state belongs here, and it names the slug it
 * wanted, because "broken" without the name gives a reader nothing to fix.
 */

import type { FC } from 'react';
import { FieldGrid, FieldRow } from '@c4s/plugin-runtime/ui';
import type { EntityCardProps } from '@c4s/plugin-runtime';
import { DependencySentence } from './sentence.js';
import type { ModuleDependency } from './types.js';

export const ModuleDependencyCard: FC<EntityCardProps<unknown>> = ({
  slug,
  entity,
  caption,
  onOpen,
}) => {
  // The slot contract hands `entity` over as `unknown` — the host resolved the
  // slug and does not know this type's shape.
  const record = entity as ModuleDependency | null;

  if (record === null) {
    return (
      <div
        data-testid="module-dependency-card"
        data-broken-ref={slug}
        className="rounded px-3 py-2 text-[12.5px]"
        style={{
          background: 'var(--c-red-soft)',
          border: '1px dashed var(--c-red)',
          color: 'var(--c-red)',
        }}
      >
        {`broken module-dependency: ${slug}`}
      </div>
    );
  }

  /*
   * The card OPENS the overlay too, not just the chip. The host builds `onOpen`
   * the same way for both slots, and a card that ignores it is a card the reader
   * can only look at — while the identical row beside it is clickable.
   */
  const interactive = typeof onOpen === 'function';

  return (
    <div
      data-testid="module-dependency-card"
      data-slug={slug}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onOpen : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      className="rounded px-3 py-2.5"
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-hair)',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      <DependencySentence dependent={record.dependent} provider={record.provider} small={false} />
      <div className="mt-2">
        <FieldGrid>
          <FieldRow label="Needs" align="start">
            <span className="text-[12.5px]" style={{ color: 'var(--c-ink)' }}>
              {record.needs}
            </span>
          </FieldRow>
        </FieldGrid>
      </div>
      {/*
        The caption belongs to the REFERENCE, not to the entity — the same edge
        embedded twice carries two different captions — so it renders here and is
        never written back.
      */}
      {caption ? (
        <div className="mt-1.5 text-[11.5px] italic" style={{ color: 'var(--c-muted)' }}>
          {caption}
        </div>
      ) : null}
    </div>
  );
};
