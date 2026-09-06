/**
 * The inline chip for `<inline_mention type="module-dependency" slug="…"/>`.
 *
 * `onOpen` IS THE WHOLE STORY, and this component contains none of it. The host
 * builds the handler in `openEntity.ts`: for a hidden module (no `routes`, no
 * `detailPanel`) it dispatches the entity-overlay event, which
 * `EntityOverlayHost` turns into this type's `renderOverlay`. `bridge.openEntity`
 * is NEVER involved, because there is no route to send it to — and the host
 * enforces that from the other side too, rejecting a `renderOverlay` on any type
 * that does have a detail route.
 *
 * The broken state falls out of the same rule rather than being coded here: an
 * unresolvable slug leaves the host unable to build a handler, so `onOpen` is
 * `undefined` and the chip is inert.
 */

import React from 'react';
import type { EntityChipProps } from '@c4s/plugin-runtime';
import type { ModuleDependency } from './types.js';

export function ModuleDependencyChip({ slug, entity, onOpen }: EntityChipProps<unknown>) {
  const record = entity as ModuleDependency | null;
  const interactive = typeof onOpen === 'function';

  if (record === null) {
    return (
      <span
        data-testid="module-dependency-chip"
        data-broken-ref={slug}
        data-slug={slug}
        title="This module dependency no longer exists."
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-baseline font-mono text-[11.5px]"
        style={{
          background: 'var(--c-red-soft)',
          border: '1px dashed var(--c-red)',
          color: 'var(--c-red)',
        }}
      >
        {`broken module-dependency: ${slug}`}
      </span>
    );
  }

  return (
    <span
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onOpen : undefined}
      onKeyDown={
        interactive
          ? (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      data-testid="module-dependency-chip"
      data-slug={slug}
      title={record.needs}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-baseline font-mono text-[11.5px]"
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-hair)',
        color: 'var(--c-ink)',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      {`${record.dependent} → ${record.provider}`}
    </span>
  );
}
