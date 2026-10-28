// @vitest-environment happy-dom
/**
 * 2.1.58 (M31 `m31l5001` Sloty) — the `Nagłówek` slot entry of the workspace
 * route: the workspace's name and the "last opened project" entry, whose click
 * loads that project's route; the entry shows only when the last opened
 * project belongs to the workspace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkspaceHeaderEntry } from './WorkspaceHeaderEntry.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let workspace: unknown;
let requests: string[];

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(WorkspaceHeaderEntry)));
  });
  await flush();
}

const entry = () => host.querySelector('[data-testid="workspace-header-entry"]');
const projectLink = () => entry()?.querySelector('a') ?? null;

const projects = [
  { id: 'alpha', name: 'Alpha', cwd: '/work/alpha', live: true },
  { id: 'beta', name: 'Beta', cwd: '/work/beta', live: false },
];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(String(url));
      return new Response(JSON.stringify(workspace), { status: 200 });
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

describe('workspace route header entry (M31 m31l5001)', () => {
  it('[section:m31l5001] shows the workspace name and a "last opened project" entry that leads to that project\'s route', async () => {
    workspace = { name: 'team-ws', kind: 'home', lastOpenedProject: 'beta', projects };
    await render();

    // One workspace-scope read, outside the project prefix.
    expect(requests).toEqual(['/api/workspace']);
    expect(entry()?.textContent).toContain('team-ws');
    const link = projectLink();
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('Last opened: Beta');
    // The click loads the project route as a document (the identity is injected there).
    expect(link!.getAttribute('href')).toBe('/p/beta/');
    expect(link!.getAttribute('target')).toBeNull();
  });

  it('[section:m31l5001] without a last opened project the entry shows only the workspace name', async () => {
    workspace = { name: 'team-ws', kind: 'registry', lastOpenedProject: null, projects };
    await render();

    expect(entry()?.textContent).toBe('team-ws');
    expect(projectLink()).toBeNull();
  });

  it('[section:m31l5001] a last opened project that no longer belongs to the workspace is not offered', async () => {
    workspace = { name: 'team-ws', kind: 'registry', lastOpenedProject: 'gone', projects };
    await render();

    expect(entry()?.textContent).toBe('team-ws');
    expect(projectLink()).toBeNull();
    expect(host.textContent).not.toContain('Last opened');
  });

  it('[section:m31l5001] is no project switcher: no list, no "Switch project" control', async () => {
    workspace = { name: 'team-ws', kind: 'registry', lastOpenedProject: 'alpha', projects };
    await render();

    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector('[aria-label="Switch project"]')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(0);
    // Only the last opened project is reachable from the entry, not the rest of the list.
    expect(host.textContent).not.toContain('Beta');
  });
});
