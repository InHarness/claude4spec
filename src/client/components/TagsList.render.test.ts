// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import type { Tag } from '../../shared/entities.js';
import type { EntityListRowProps } from '../host-ui-kit/list/EntityListRow.js';
import type { InlineEditFieldProps } from '../host-ui-kit/form/InlineEditField.js';
import type { PopoverProps } from '../host-ui-kit/overlay-feedback/Popover.js';

/**
 * M18 `/tags` (ui-view `tags-list`) as a consumer of the host UI kit (L12):
 * `TagsList` renders each tag through `EntityListRow`, with the colour dot in
 * the `leading` slot (the `icon` slot takes a `LucideIcon` only, so it stays
 * unused), the name in `children` and the per-type counters in `trailing`; the
 * name and the colour are edited inline through `InlineEditField` and
 * `Popover` (2.1.28, record `tags-list`).
 *
 * The catalogue components are the real entries, wrapped so the test can read
 * the props each one was given as well as the markup it rendered.
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

const { mutate, rowProps, editProps, popoverProps } = vi.hoisted(() => ({
  mutate: vi.fn(),
  rowProps: [] as EntityListRowProps[],
  editProps: [] as InlineEditFieldProps[],
  popoverProps: [] as PopoverProps[],
}));

vi.mock('../hooks/useTags.js', () => ({
  useTags: () => ({ data: TAGS, isLoading: false }),
  useUpdateTag: () => ({ mutate }),
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

// React's development build also calls a function component with NO arguments,
// outside rendering, to build a component stack for a warning raised beneath
// it. That call is not a render, so each wrapper records only calls with props.
vi.mock('../host-ui-kit/list/EntityListRow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../host-ui-kit/list/EntityListRow.js')>();
  return {
    ...actual,
    EntityListRow: (props?: EntityListRowProps) => {
      if (props && typeof props === 'object') rowProps.push(props);
      return createElement(actual.EntityListRow, props as EntityListRowProps);
    },
  };
});
vi.mock('../host-ui-kit/form/InlineEditField.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../host-ui-kit/form/InlineEditField.js')>();
  return {
    ...actual,
    InlineEditField: (props?: InlineEditFieldProps) => {
      if (props && typeof props === 'object') editProps.push(props);
      return createElement(actual.InlineEditField, props as InlineEditFieldProps);
    },
  };
});
vi.mock('../host-ui-kit/overlay-feedback/Popover.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../host-ui-kit/overlay-feedback/Popover.js')>();
  return {
    ...actual,
    Popover: (props?: PopoverProps) => {
      if (props && typeof props === 'object') popoverProps.push(props);
      return createElement(actual.Popover, props as PopoverProps);
    },
  };
});

const { TagsList } = await import('./TagsList.js');

// Resolved with node:path from the module's own file path — under happy-dom the global `URL`
// is the window's, so `new URL(rel, import.meta.url)` is not a `file:` URL that `fileURLToPath`
// accepts.
const HERE = dirname(fileURLToPath(import.meta.url));

const markupOf = (node: ReactNode) => renderToStaticMarkup(createElement('div', null, node));

/** TagsList.tsx without comments — the doc comments legitimately NAME what is gone. */
const screenCode = readFileSync(resolve(HERE, './TagsList.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** Every host-ui-kit module the screen imports. */
const kitImports = [...screenCode.matchAll(/from '\.\.\/host-ui-kit\/([^']+)'/g)].map((m) => m[1]!);

beforeEach(() => {
  mutate.mockReset();
  rowProps.length = 0;
  editProps.length = 0;
  popoverProps.length = 0;
});

describe('TagsList — rows through EntityListRow slots', () => {
  it('[section:xfkinig4] /tags renders each tag through EntityListRow: the colour dot in `leading` (no `icon`), the name in `children`, the per-type counters in `trailing`', () => {
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

  it('[section:xfkinig4] the screen composes only catalog components the M18 slice lists as consumed — EntityListRow, InlineEditField, Popover among them', () => {
    // `Components consumed` (2.1.28): badge, tag-picker, tag-filter-bar, popover,
    // entity-list-row, entity-list-header, empty-state, dialog, form-field,
    // action-button, inline-edit-field — no host-local component is declared.
    const consumed = new Set([
      'actions/Badge.js',
      'detail/TagPicker.js',
      'list/TagFilterBar.js',
      'overlay-feedback/Popover.js',
      'list/EntityListRow.js',
      'core/EntityListHeader.js',
      'list/EmptyState.js',
      'overlay/Dialog.js',
      'form/FormField.js',
      'actions/ActionButton.js',
      'form/InlineEditField.js',
    ]);
    expect(kitImports).toEqual(
      expect.arrayContaining(['list/EntityListRow.js', 'form/InlineEditField.js', 'overlay-feedback/Popover.js']),
    );
    for (const mod of kitImports) expect(consumed.has(mod), mod).toBe(true);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TagsList — ui-view `tags-list`', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(createElement(TagsList)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('[entity:tags-list] a tag row is the catalog EntityListRow — dot in `leading`, name in `children`, per-type counts in `trailing`', () => {
    const rows = rowProps.filter((p) => p.leading != null);
    expect(rows.length).toBeGreaterThanOrEqual(TAGS.length);
    const last = rows[rows.length - 1]!;
    expect(last.icon).toBeUndefined();
    expect(markupOf(last.leading)).toContain('aria-label="Change tag color"');
    expect(markupOf(last.children)).toContain('Auth');
    expect(markupOf(last.trailing as ReactElement)).toContain('2 endpoints · 1 DTO');
    // The page shows what the row rendered: name and counters in the live DOM.
    expect(host.textContent).toContain('Auth');
    expect(host.textContent).toContain('2 endpoints · 1 DTO');
  });

  it('[entity:tags-list] the name is edited inline through the catalog InlineEditField, without leaving the view', () => {
    expect(editProps.at(-1)).toMatchObject({ value: 'Auth' });

    // Click the name → the field's own input appears in place.
    const nameButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Auth')!;
    expect(nameButton).toBeTruthy();
    act(() => nameButton.click());
    const input = host.querySelector('input')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Auth');

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(input, 'Authn');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    // Exactly one rename reaches the update mutation: Enter commits, and a blur
    // as the input leaves the DOM must not send the same draft a second time.
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ slug: 'auth', input: { name: 'Authn' } });
    // Still the same view: the list is mounted, the input closed back to the value.
    expect(host.querySelector('input')).toBeNull();
    expect(host.textContent).toContain('2 endpoints · 1 DTO');
  });

  it('[entity:tags-list] the colour is edited inline through the catalog Popover, anchored on the dot', () => {
    // Closed until the dot is clicked; the consumer owns `open`.
    expect(popoverProps.at(-1)).toMatchObject({ open: false, title: 'Tag color' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const dot = host.querySelector<HTMLElement>('[aria-label="Change tag color"]')!;
    act(() => dot.click());
    const last = popoverProps.at(-1)!;
    expect(last.open).toBe(true);
    expect(last.anchorRef?.current).toBe(dot);
    const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Tag color"]')!;
    expect(panel).not.toBeNull();

    act(() => panel.querySelector<HTMLButtonElement>('button[aria-label="#7d9a6d"]')!.click());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ slug: 'auth', input: { color: '#7d9a6d' } });
    expect(popoverProps.at(-1)!.open).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('[entity:tags-list] no bespoke row, edit field or floating panel replaces the catalog parts', () => {
    // The screen draws no input and no floating panel of its own: the name's
    // input is InlineEditField's, the colour panel is Popover's.
    expect(screenCode).not.toMatch(/<input\b|<textarea\b/);
    expect(screenCode).not.toMatch(/position:\s*['"]fixed['"]|createPortal|role="dialog"/);
    // A row is the catalog row — no hand-rolled row container per tag.
    expect(screenCode).toMatch(/<EntityListRow\b/);
    expect(kitImports).toEqual(
      expect.arrayContaining(['list/EntityListRow.js', 'form/InlineEditField.js', 'overlay-feedback/Popover.js']),
    );
  });
});
