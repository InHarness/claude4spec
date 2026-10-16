import { describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Tag } from '../../shared/entities.js';
import type { EntityListRowProps } from '../host-ui-kit/list/EntityListRow.js';

/**
 * 2.1.26 — M18 `/tags` as a consumer of the host UI kit (L12): `TagsList`
 * renders each tag through `EntityListRow`, with the colour dot in the
 * `leading` slot (the `icon` slot takes a `LucideIcon` only, so it stays
 * unused), the name in `children` and the per-type counters in `trailing`.
 *
 * The row component is the real catalogue entry, wrapped so the test can read
 * the props each row was given as well as the markup it rendered.
 */

const TAGS: Tag[] = [
  {
    slug: 'auth',
    name: 'Auth',
    color: '#c45a3b',
    description: null,
    counts: { endpoint: 2, dto: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const rowProps: EntityListRowProps[] = [];

vi.mock('../hooks/useTags.js', () => ({
  useTags: () => ({ data: TAGS, isLoading: false }),
  useUpdateTag: () => ({ mutate: () => {} }),
}));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: {
    listEntities: () => [
      { type: 'endpoint', label: 'endpoint', labelPlural: 'endpoints' },
      { type: 'dto', label: 'DTO', labelPlural: 'DTOs' },
    ],
  },
}));
vi.mock('../ui/events.js', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }));
vi.mock('../host-ui-kit/list/EntityListRow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../host-ui-kit/list/EntityListRow.js')>();
  return {
    ...actual,
    EntityListRow: (props?: EntityListRowProps) => {
      // React's development build also calls a function component with NO
      // arguments, outside rendering, to build a component stack for a warning
      // raised beneath it (here: `Popover`'s `useLayoutEffect` on the server).
      // That call is not a row, so only a call that received props is recorded.
      if (props && typeof props === 'object') rowProps.push(props);
      return createElement(actual.EntityListRow, props as EntityListRowProps);
    },
  };
});

const { TagsList } = await import('./TagsList.js');

const markupOf = (node: ReactNode) => renderToStaticMarkup(createElement('div', null, node));

describe('TagsList — rows through EntityListRow slots', () => {
  it('[section:xfkinig4] /tags renders each tag through EntityListRow: the colour dot in `leading` (no `icon`), the name in `children`, the per-type counters in `trailing`', () => {
    rowProps.length = 0;
    const html = renderToStaticMarkup(createElement(TagsList));

    // One row per tag — in the markup, and in the rows the component was given.
    const count = (needle: string) => html.split(needle).length - 1;
    expect(count('aria-label="Change tag color"')).toBe(TAGS.length);
    expect(count('2 endpoints · 1 DTO')).toBe(TAGS.length);
    expect(count('>Auth<')).toBe(TAGS.length);
    expect(rowProps).toHaveLength(TAGS.length);

    for (const props of rowProps) {
      // `icon` takes a LucideIcon only — the dot does not go there.
      expect(props.icon).toBeUndefined();

      // `leading`: the colour dot, in the tag's colour.
      expect(isValidElement(props.leading)).toBe(true);
      const leading = markupOf(props.leading);
      expect(leading).toContain('aria-label="Change tag color"');
      expect(leading).toContain('background:#c45a3b');
      expect(leading).not.toContain('Auth');

      // `children`: the name (inline-editable), not the dot nor the counters.
      const children = markupOf(props.children);
      expect(children).toContain('Auth');
      expect(children).not.toContain('Change tag color');
      expect(children).not.toContain('2 endpoints');

      // `trailing`: the per-type counters, one per active type.
      const trailing = markupOf(props.trailing as ReactElement);
      expect(trailing).toContain('2 endpoints · 1 DTO');
      expect(trailing).not.toContain('Auth');
    }

    // And the row itself renders all three, dot first, counters last.
    const dotAt = html.indexOf('Change tag color');
    const nameAt = html.indexOf('>Auth<');
    const countsAt = html.indexOf('2 endpoints · 1 DTO');
    expect(dotAt).toBeGreaterThan(-1);
    expect(nameAt).toBeGreaterThan(dotAt);
    expect(countsAt).toBeGreaterThan(nameAt);
  });
});
