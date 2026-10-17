// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EmptyStateProps } from '../host-ui-kit/list/EmptyState.js';
import type { ActionButtonProps } from '../host-ui-kit/actions/ActionButton.js';
import { resolveLandingTarget } from '../lib/landing.js';

/**
 * ui-view `home-redirect-empty-state` (route `/`, 2.1.28): when the landing
 * chain (M02 `4dcvgivu`) finds nothing — an empty page tree — the route renders
 * the catalog `EmptyState` with the "Create your first page" CTA. The catalog
 * components are the real entries, wrapped so the test reads the props each
 * one was given as well as the markup it rendered.
 */

const { emptyProps, buttonProps } = vi.hoisted(() => ({
  emptyProps: [] as EmptyStateProps[],
  buttonProps: [] as ActionButtonProps[],
}));

// React's development build may call a function component with no props to
// build a component stack; only calls with props are recorded.
vi.mock('../host-ui-kit/list/EmptyState.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../host-ui-kit/list/EmptyState.js')>();
  const { createElement: h } = await import('react');
  return {
    ...real,
    EmptyState: (p?: EmptyStateProps) => {
      if (p) emptyProps.push(p);
      return p ? h(real.EmptyState, p) : null;
    },
  };
});
vi.mock('../host-ui-kit/actions/ActionButton.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../host-ui-kit/actions/ActionButton.js')>();
  const { createElement: h } = await import('react');
  return {
    ...real,
    ActionButton: (p?: ActionButtonProps) => {
      if (p) buttonProps.push(p);
      return p ? h(real.ActionButton, p) : null;
    },
  };
});

import { HomeEmptyState, HOME_EMPTY_CTA, HOME_EMPTY_TITLE } from './HomeEmptyState.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTER_SRC = readFileSync(resolve(HERE, '../router.tsx'), 'utf-8');
const HOME_SRC = readFileSync(resolve(HERE, './HomeEmptyState.tsx'), 'utf-8');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  emptyProps.length = 0;
  buttonProps.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('[entity:home-redirect-empty-state] route / — empty tree state', () => {
  it('[entity:home-redirect-empty-state] renders the catalog EmptyState with a "Create your first page" CTA (catalog ActionButton) that starts a new page', () => {
    const onNewPage = vi.fn();
    act(() => root.render(createElement(HomeEmptyState, { onNewPage })));

    expect(emptyProps.length).toBeGreaterThan(0);
    const empty = emptyProps.at(-1)!;
    expect(empty.title).toBe(HOME_EMPTY_TITLE);
    expect(empty.action).toBeDefined();
    // The CTA is the catalog ActionButton in the EmptyState's action slot.
    const cta = buttonProps.find((b) => b.label === HOME_EMPTY_CTA);
    expect(cta).toBeDefined();
    expect(HOME_EMPTY_CTA).toBe('Create your first page');

    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Create your first page',
    )!;
    expect(btn).toBeDefined();
    act(() => btn.click());
    expect(onNewPage).toHaveBeenCalledTimes(1);
    // The catalog card (dashed border) carries the title.
    expect(container.textContent).toContain(HOME_EMPTY_TITLE);
  });

  it('[entity:home-redirect-empty-state] the bespoke 2.1.27 welcome card is gone — no own heading, no hand-styled buttons, no own colour literals', () => {
    const code = HOME_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/<button\b/);
    expect(code).not.toMatch(/<h[1-6]\b/);
    expect(code).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(code).toMatch(/from '\.\.\/host-ui-kit\/list\/EmptyState\.js'/);
    expect(code).toMatch(/from '\.\.\/host-ui-kit\/actions\/ActionButton\.js'/);
  });

  it('[entity:home-redirect-empty-state] the / route renders the empty state only when the landing chain finds no page (empty tree), and redirects to /space/<rootId>/<path> otherwise', () => {
    const index = ROUTER_SRC.slice(ROUTER_SRC.indexOf('function IndexRoute()'));
    const body = index.slice(0, index.indexOf('\n}\n'));
    expect(body).toMatch(/resolveLandingTarget\(/);
    expect(body).toMatch(/<Navigate to="\/space\/\$rootId\/\$"/);
    expect(body).toMatch(/<HomeEmptyState onNewPage=\{promptNewPage\} \/>/);
    // The old host component is not used anywhere in the router.
    expect(ROUTER_SRC).not.toMatch(/components\/EmptyState\.js/);

    // Step 5: an empty tree in the builtin root resolves to no target.
    const roots = [{ id: 'pages', builtin: true, kind: 'pages' }] as never;
    expect(resolveLandingTarget({ lastPage: null, roots, pagesTree: [], lastPageTree: [] })).toBeNull();
  });

  it('[ac:ac-wejscie-na-przy-pustym-drzewie-stron] entering / with an empty page tree renders the EmptyState with the "Create your first page" CTA', () => {
    // An empty tree — no remembered page, nothing in the base root — resolves to no landing target…
    const roots = [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }] as never;
    expect(resolveLandingTarget({ lastPage: null, roots, pagesTree: [], lastPageTree: [] })).toBeNull();
    // …even when a stale remembered page points into it.
    expect(
      resolveLandingTarget({ lastPage: { rootId: 'pages', path: 'gone.md' }, roots, pagesTree: [], lastPageTree: [] }),
    ).toBeNull();

    // …and on a null target the `/` route renders HomeEmptyState (not a redirect).
    const index = ROUTER_SRC.slice(ROUTER_SRC.indexOf('function IndexRoute()'));
    const body = index.slice(0, index.indexOf('\n}\n'));
    const afterTarget = body.slice(body.indexOf('if (target) {'));
    expect(afterTarget).toMatch(/return <Navigate[\s\S]*?\}\s*return \(\s*<RoutePane>\s*<HomeEmptyState onNewPage=\{promptNewPage\} \/>/);

    // HomeEmptyState is the catalog EmptyState whose action is the CTA "Create your first page".
    act(() => root.render(createElement(HomeEmptyState, { onNewPage: vi.fn() })));
    expect(emptyProps.length).toBeGreaterThan(0);
    expect(emptyProps.at(-1)!.action).toBeDefined();
    expect(buttonProps.some((b) => b.label === 'Create your first page')).toBe(true);
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).toContain('Create your first page');
  });
});
