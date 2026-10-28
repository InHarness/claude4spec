// @vitest-environment happy-dom
/**
 * 2.1.58 (M50 `8h2a734u`, Nagłówek → pasek **Branding**) — on a project route
 * the first strip of the sidebar header holds the application branding and the
 * settings gear (shell elements), and beside them the `Nagłówek` slot entry
 * with the project name and the project switcher; the gear leads to the
 * project settings page (`/settings` under the project basepath `/p/<id>`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ navigations: [] as unknown[] }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children }: { children?: unknown }) => createElement('a', { href: '#' }, children as never),
    useNavigate: () => (opts: unknown) => {
      h.navigations.push(opts);
    },
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: '/' } }),
  };
});

vi.mock('../hooks/useConfig.js', () => ({
  useRoots: () => [],
  useBaseRootId: () => null,
  useElementsMenuLayout: () => ({ ready: true, layout: undefined }),
}));

vi.mock('../hooks/usePages.js', () => ({
  usePages: () => ({ data: [] }),
  useSidebarAccordions: () => ({ data: [], isSuccess: true }),
  usePagesSearch: () => ({ data: [], isFetching: false }),
}));

// The later strips, as markers: the Branding strip must come before them.
vi.mock('./UserSection.js', () => ({
  UserSection: () => createElement('div', { 'data-testid': 'strip-user' }),
}));
vi.mock('./GitStatusBadge.js', () => ({
  GitStatusBadge: () => createElement('div', { 'data-testid': 'strip-git' }),
}));
// The switcher's own behaviour has its own test; here it is the slot entry the
// strip carries, with the project name it was handed.
vi.mock('./ProjectSwitcher.js', () => ({
  ProjectSwitcher: (props: { projectName?: string | null; cwdPath?: string }) =>
    createElement(
      'div',
      { 'data-testid': 'project-switcher', 'data-cwd': props.cwdPath ?? '' },
      props.projectName ?? '',
    ),
}));

import { Sidebar } from './Sidebar.js';
import { APPEARANCE_SETTINGS } from './shell/AppearanceElement.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.navigations.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(Sidebar, {
          width: 300,
          cwdPath: '/work/app-spec',
          projectName: 'App spec',
          headerLoading: false,
          entityCounts: {},
          todoCount: 0,
          todoCountByPath: {},
          brokenLinkCount: 0,
          unresolvedMentionCount: 0,
        }),
      ),
    );
  });
}

describe('M50 project-route header — the Branding strip', () => {
  it('[section:8h2a734u] the first strip holds the app branding, the gear and the Nagłówek entry with the project name and switcher; the gear navigates to the project settings page', async () => {
    render();

    const aside = host.querySelector('aside')!;
    expect(aside).not.toBeNull();
    // The Branding strip is the first strip of the header, above Logowanie and Git.
    const strip = aside.firstElementChild as HTMLElement;
    const user = aside.querySelector('[data-testid="strip-user"]')!;
    const git = aside.querySelector('[data-testid="strip-git"]')!;
    expect(user).not.toBeNull();
    expect(git).not.toBeNull();
    expect(strip.contains(user)).toBe(false);
    expect(strip.compareDocumentPosition(user) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(user.compareDocumentPosition(git) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Application branding — a shell element of the strip.
    const branding = strip.querySelector<HTMLAnchorElement>('a[href="https://claude4spec.inharness.ai"]');
    expect(branding).not.toBeNull();
    // Beside it: the `Nagłówek` slot entry with the project name and the switcher.
    const switcher = strip.querySelector<HTMLElement>('[data-testid="project-switcher"]');
    expect(switcher).not.toBeNull();
    expect(switcher!.textContent).toBe('App spec');
    expect(switcher!.getAttribute('data-cwd')).toBe('/work/app-spec');
    // The settings gear — also in the strip.
    const gear = strip.querySelector<HTMLButtonElement>('button[aria-label="Open settings"]');
    expect(gear).not.toBeNull();
    // Order within the strip: branding, then the slot entry, then the gear.
    const kids = Array.from(strip.children);
    expect(kids.indexOf(branding!)).toBeLessThan(kids.indexOf(switcher!));
    expect(kids.indexOf(switcher!)).toBeLessThan(kids.indexOf(gear!));

    // On a project route the gear leads to the project settings page: the
    // router's `/settings`, resolved under the project basepath `/p/<id>`.
    await act(async () => {
      gear!.click();
    });
    expect(h.navigations).toEqual([{ to: '/settings' }]);
  });

  it('[ac:ac-ikona-zebatki-w-prawym-gornym-rogu] the header shows the gear icon (no text [Settings] button); a click navigates to /settings; the header has no light/dark toggle — the theme changes only on the Appearance card of the workspace settings page', async () => {
    render();
    const aside = host.querySelector('aside')!;
    const strip = aside.firstElementChild as HTMLElement;

    // The gear: an icon button at the end of the top strip, labelled for a11y, with no visible text.
    const gear = strip.querySelector<HTMLButtonElement>('button[aria-label="Open settings"]')!;
    expect(gear).not.toBeNull();
    expect(gear.querySelector('svg')).not.toBeNull();
    expect(gear.textContent).toBe('');
    expect(strip.lastElementChild).toBe(gear);
    expect([...aside.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Settings')).toBe(false);

    await act(async () => {
      gear.click();
    });
    expect(h.navigations).toEqual([{ to: '/settings' }]);

    // No theme switch anywhere in the header.
    expect(aside.querySelector('.lucide-sun, .lucide-moon, .lucide-monitor')).toBeNull();
    for (const b of aside.querySelectorAll('button')) {
      const label = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''} ${b.textContent ?? ''}`;
      expect(label).not.toMatch(/\btheme\b|\bdark\b|\blight\b/i);
    }
    // The theme's one control is the Appearance card, which stands on the workspace settings page.
    expect(APPEARANCE_SETTINGS.cards).toEqual([expect.objectContaining({ anchor: 'appearance', scope: 'workspace' })]);
  });
});
