// @vitest-environment happy-dom
/**
 * 2.1.21 (M26 — ui-view `settings-page`, L17 `7f76eszm`): `/settings` is ONE
 * vertical stack of cards assembled from the declared card and element tables
 * plus the implementor's own cards (About, Index status). There is no plugin
 * settings channel any more: no generated `#plugin-<name>` cards, and the page
 * never asks the plugin host for settings sections.
 *
 * The card frame is stubbed — what each card renders inside is pinned by the
 * owning modules' tests (`catalog.test.ts`); this test pins the page composition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigResponse } from '../../lib/api.js';
import type { AssembledCard } from './registry.js';

vi.mock('./SettingsCardFrame.js', async () => {
  const { createElement: h } = await import('react');
  return {
    SettingsCardFrame: ({ card }: { card: AssembledCard }) =>
      h('section', { id: card.decl.anchor, 'data-card': card.decl.anchor, 'data-group': card.decl.group }, card.decl.title),
  };
});

// The sidebar slot's link, reduced to what it would navigate to.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { createElement: h } = await import('react');
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: ({ to, hash, children }: { to: string; hash?: string; children?: unknown }) =>
      h('a', { href: hash ? `${to}#${hash}` : to, 'data-to': to, 'data-hash': hash ?? '' }, children as never),
  };
});

import { SettingsPage, staticSettingsContributions } from './SettingsPage.js';
import { assembleSettings } from './registry.js';
import { UserSection } from '../UserSection.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG = {
  name: 'demo',
  description: null,
  roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
  writingStyle: null,
  writingStyleUnavailable: null,
  language: null,
  onboarding: { completed: true },
  agent: {
    claudeUsePreset: false,
    conversationalLanguage: null,
    allowedPaths: [],
    disallowedPaths: [],
    disableDirectFilesystemAccess: true,
    pathScopeStrength: 'none',
  },
  git: {
    enabled: false,
    syncPushOnRelease: false,
    commitTarget: { mode: 'current', branch: null, template: null, base: null },
    switchAfterRelease: false,
  },
  remoteApiUrl: null,
  $schemaVersion: 4,
  configHash: 'h',
} as unknown as ConfigResponse;

let host: HTMLDivElement;
let root: Root;
let fetched: string[];

beforeEach(() => {
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(): Promise<string[]> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['config'], CONFIG);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(SettingsPage)));
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return [...host.querySelectorAll('[data-card]')].map((el) => el.getAttribute('data-card')!);
}

describe('SettingsPage — composition without a plugin settings channel (2.1.21)', () => {
  it('[entity:settings-page] renders one stack of the declared cards in group → weight order, with no group headings and no generated plugin cards', async () => {
    const anchors = await render();
    const expected = assembleSettings(staticSettingsContributions()).map((c) => c.decl.anchor);
    expect(anchors).toEqual(expected);
    // The implementor's own diagnostic cards are part of the stack.
    expect(anchors).toContain('about');
    expect(anchors).toContain('index-status');
    // One stack: the only heading on the page is its title — groups order, they do not head.
    expect([...host.querySelectorAll('h1, h2, h3')].map((h) => h.textContent)).toEqual(['Settings']);
    // No `#plugin-<name>` card: the one `plugin-` anchor left is the pool card the host declares.
    expect(anchors.filter((a) => a.startsWith('plugin-'))).toEqual(['plugin-pool']);
  });

  it('[section:7f76eszm] the card registry is the declared cards plus About and Index status — nothing is generated for plugins, and the page never asks for plugin settings', async () => {
    const anchors = await render();
    const declared = staticSettingsContributions().flatMap((c) => c.cards ?? []).map((c) => c.anchor);
    expect(new Set(anchors)).toEqual(new Set(declared));
    expect(anchors).toHaveLength(declared.length);
    expect(fetched.some((url) => url.includes('plugin-settings'))).toBe(false);
  });
});

describe('SettingsPage — entry from the sidebar avatar (M24 → M26)', () => {
  it('[ac:ac-klik-na-avatar-w-sidebarze-m24-stan-zal] the signed-in sidebar avatar (connected: true) links to /settings#user-section, and the page smooth-scrolls to the User card for that hash', async () => {
    // The M24 slot, signed in (seeded, not refetched: the fetch stub answers `{}`).
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['remote-account'], {
      connected: true,
      remoteAccountId: 'a',
      accountEmail: 'ada@example.com',
      accountStatus: 'active',
      connectedAt: '2026-10-01T10:00:00.000Z',
    });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(UserSection)));
    });
    const avatar = host.querySelector('a')!;
    expect(avatar).not.toBeNull();
    expect(avatar.textContent).toContain('AD'); // the avatar initials
    expect(avatar.getAttribute('data-to')).toBe('/settings');
    expect(avatar.getAttribute('data-hash')).toBe('user-section');
    expect(avatar.getAttribute('href')).toBe('/settings#user-section');

    // Landing on that URL: the page scrolls smoothly to the User card.
    const scrolled: Array<{ id: string; opts: unknown }> = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, opts?: unknown) {
      scrolled.push({ id: this.id, opts });
    } as typeof HTMLElement.prototype.scrollIntoView;
    try {
      window.location.hash = '#user-section';
      const anchors = await render();
      expect(anchors[0]).toBe('user-section');
      expect(scrolled).toContainEqual({ id: 'user-section', opts: { behavior: 'smooth', block: 'start' } });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
      window.location.hash = '';
    }
  });
});
