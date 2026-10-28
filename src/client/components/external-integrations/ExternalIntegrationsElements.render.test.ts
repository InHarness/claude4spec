// @vitest-environment happy-dom
/**
 * M26 `#external-integrations` card (ui-view `settings-page`): a read-only
 * export for agents working outside the app. It is mounted through the real
 * card frame (the one that adds [Save] to file-backed cards) and every action of
 * both blocks — skills and MCP connection — is exercised against a fetch stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigResponse } from '../../lib/api.js';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({}),
}));

import { EXTERNAL_INTEGRATIONS_SETTINGS } from './ExternalIntegrationsElements.js';
import { SettingsCardFrame } from '../settings/SettingsCardFrame.js';
import { assembleSettings } from '../settings/registry.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG = { name: 'demo', configHash: 'h', agent: {} } as unknown as ConfigResponse;

let host: HTMLDivElement;
let root: Root;
let requests: Array<{ url: string; method: string }>;

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/external-skills') {
        return json({
          skills: [
            { slug: 'c4s-spec-reader', name: 'c4s-spec-reader', description: 'Read the spec' },
            { slug: 'c4s-refactor', name: 'c4s-refactor', description: 'Reconcile spec and code' },
          ],
          projectId: 'demo',
        });
      }
      if (url.startsWith('/api/external-skills/bundle')) return new Response(new Blob(['zip']), { status: 200 });
      if (url === '/api/_meta/mcp-config') {
        return json({
          variants: [
            { id: 'http-project', label: 'HTTP (project)', snippet: '{"a":1}' },
            { id: 'http-workspace', label: 'HTTP (workspace)', snippet: '{"b":2}' },
            { id: 'stdio', label: 'stdio', snippet: '{"c":3}' },
          ],
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
  URL.createObjectURL = vi.fn(() => 'blob:zip');
  URL.revokeObjectURL = vi.fn();
  // The ZIP download clicks a detached <a download>; keep happy-dom from navigating.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('External Integrations card (M26)', () => {
  it('[ac:ac-karta-external-integrations-nie-ma-pr] the External Integrations card has no [Save], and no action in either of its two blocks mutates config.json', async () => {
    const [card] = assembleSettings([EXTERNAL_INTEGRATIONS_SETTINGS], 'project');
    expect(card!.decl.anchor).toBe('external-integrations');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(SettingsCardFrame, { card: card!, config: CONFIG })));
    });
    await flush();

    // Both blocks are on the card.
    const skills = host.querySelector<HTMLElement>('[data-testid="external-integrations-skills"]')!;
    const mcp = host.querySelector<HTMLElement>('[data-testid="external-integrations-mcp"]')!;
    expect(skills).not.toBeNull();
    expect(mcp).not.toBeNull();

    // No [Save] — neither the frame's per-card save nor any button so labelled.
    expect(host.querySelector('[data-testid="settings-save-external-integrations"]')).toBeNull();
    const labels = () => Array.from(host.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels()).not.toContain('Save');

    // Every action of both blocks: toggle each skill, download, switch every pill, copy.
    for (const box of Array.from(skills.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      await act(async () => {
        box.click();
      });
      await act(async () => {
        box.click();
      });
    }
    await flush();
    for (const btn of Array.from(host.querySelectorAll('button'))) {
      await act(async () => {
        btn.click();
      });
      await flush();
    }
    expect(requests.some((r) => r.url.startsWith('/api/external-skills/bundle'))).toBe(true);
    expect(mcp.querySelectorAll('[role="tab"]')).toHaveLength(3);

    // Nothing was written: every request is a read, and none touches /api/config.
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
    expect(requests.some((r) => r.url.startsWith('/api/config'))).toBe(false);
    expect(labels()).not.toContain('Save');
  });
});
