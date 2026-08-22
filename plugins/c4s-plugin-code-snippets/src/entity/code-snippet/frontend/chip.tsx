import React from 'react';
import { Code2 } from 'lucide-react';
import type { EntityChipProps } from '@c4s/plugin-runtime';
import type { CodeSnippet } from './hooks.js';

/**
 * The inline chip for `<inline_mention type="code-snippet" slug="…"/>`.
 *
 * `onOpen` IS THE WHOLE STORY, and this component deliberately contains none of
 * it. The host builds the handler in `openEntity.ts`: for a hidden module (no
 * `routes`, no `detailPanel`) it dispatches the entity-overlay event, which
 * `EntityOverlayHost` turns into this type's `renderOverlay`. `bridge.openEntity`
 * is never involved, because there is no route to send it to.
 *
 * The broken state falls out of the same rule rather than being coded here: a
 * slug that resolves to nothing — or a type dropped from `config.entities` —
 * leaves the host unable to build a handler, so `onOpen` is `undefined` and the
 * chip renders as text with no click behaviour. That is exactly the required
 * behaviour ("a click on a broken chip does nothing"), and it holds without this
 * file knowing the word "broken".
 */
export function CodeSnippetChip({ slug, entity, onOpen }: EntityChipProps<unknown>) {
  // The slot contract hands `entity` over as `unknown` — it is the host that
  // resolved the slug, and it does not know this type's shape. `null` means the
  // reference is broken.
  const record = entity as CodeSnippet | null;
  const label = record?.title ?? slug;
  const interactive = typeof onOpen === 'function';

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
      data-testid="code-snippet-chip"
      data-slug={slug}
      title={record?.filename ?? label}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-baseline font-mono text-[11.5px]"
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-hair)',
        color: 'var(--c-ink)',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      <Code2 size={11} style={{ color: 'var(--c-accent)' }} />
      {label}
    </span>
  );
}
