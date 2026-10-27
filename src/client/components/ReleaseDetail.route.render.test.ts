// @vitest-environment happy-dom
/**
 * M17 ui-view `release-detail` — the screen is addressed by the release NAME:
 * `/releases/<name>` opens the detail of the release with that name, and an
 * inline rename moves the open route to the new name (the old one is no longer
 * an address).
 *
 * The router is the REAL one: `router.tsx`'s base routes under its root route,
 * driven by a memory history. Only the shell (`RootLayout` → a bare `<Outlet/>`)
 * and the data hooks are stubbed; the release screen itself is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import type { ReleaseDetail as ReleaseDetailData } from '../../shared/entities.js';

const state = vi.hoisted(() => ({
  /** The releases the stubbed API knows, by name. */
  releases: new Map<string, unknown>(),
  /** Every name `useRelease` was asked for, in order. */
  asked: [] as Array<string | undefined>,
  /** `useUpdateRelease().mutateAsync` arguments. */
  updates: [] as unknown[],
  forgotten: [] as string[],
}));

vi.mock('../App.js', async () => {
  const { Outlet } = await import('@tanstack/react-router');
  const React = await import('react');
  return { RootLayout: () => React.createElement(Outlet) };
});
vi.mock('../hooks/useReleases.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useReleases.js')>();
  return {
    ...actual,
    useRelease: (name: string | undefined) => {
      state.asked.push(name);
      return { data: name === undefined ? undefined : state.releases.get(name), isLoading: false };
    },
    useReleaseList: () => ({ data: Array.from(state.releases.values()) }),
    useReleaseDiff: () => ({ data: undefined }),
    useReleaseSnapshot: () => ({ data: undefined }),
    useRestoreSpec: () => ({ mutateAsync: async () => {} }),
    forgetReleaseName: (_qc: unknown, oldName: string) => {
      state.forgotten.push(oldName);
    },
    useUpdateRelease: () => ({
      isPending: false,
      mutateAsync: async (args: { releaseName: string; name?: string }) => {
        state.updates.push(args);
        const current = state.releases.get(args.releaseName) as ReleaseDetailData;
        const updated = { ...current, name: args.name ?? current.name };
        // The server renames the release: the old name stops resolving.
        state.releases.delete(args.releaseName);
        state.releases.set(updated.name, updated);
        return updated;
      },
    }),
  };
});
vi.mock('../hooks/useConfig.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useConfig.js')>();
  return { ...actual, useConfig: () => ({ data: { name: 'p' } }) };
});
vi.mock('./release/DeltaSection.js', () => ({ DeltaSection: () => null }));
vi.mock('./release/ReleaseSelect.js', () => ({ ReleaseSelect: () => null }));
vi.mock('./CreateBriefDialog.js', () => ({ CreateBriefDialog: () => null }));

import { BASE_ROUTE_CHILDREN, rootRoute } from '../router.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function release(id: number, name: string, description: string): ReleaseDetailData {
  return {
    id,
    name,
    description,
    createdBy: 'user',
    createdAt: `2026-10-0${id}T10:00:00.000Z`,
    acceptedShadow: null,
    countBreakdown: { entities: {}, pages: 0, total: 0 },
  };
}

let host: HTMLDivElement;
let root: Root;

function makeRouter(path: string) {
  return createRouter({
    routeTree: rootRoute.addChildren([...BASE_ROUTE_CHILDREN]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  });
}

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function open(path: string) {
  const router = makeRouter(path);
  const qc = new QueryClient();
  await act(async () => {
    await router.load();
  });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(RouterProvider, { router } as never)));
  });
  await flush();
  return router;
}

const nameInput = () => host.querySelector<HTMLInputElement>('input[title^="Click to rename"]');

beforeEach(() => {
  state.releases.clear();
  state.asked.length = 0;
  state.updates.length = 0;
  state.forgotten.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('release detail — addressed by name (M17 release-detail)', () => {
  it('[ac:ac-trasa-releases-nazwa-otwiera-widok-de] the route /releases/<name> opens the detail view of the release with that name', async () => {
    // Newest first, as the list API answers; `0.2.33` is the OLDER one (read-only header).
    state.releases.set('0.2.34', release(2, '0.2.34', 'The newer release'));
    state.releases.set('0.2.33', release(1, '0.2.33', 'Kontrakty wire jako encje'));

    const router = await open('/releases/0.2.33');

    expect(router.state.location.pathname).toBe('/releases/0.2.33');
    // The screen asked for exactly the release the URL names…
    expect(state.asked.length).toBeGreaterThan(0);
    expect(new Set(state.asked)).toEqual(new Set(['0.2.33']));
    // …and shows it: its name in the header, its description, not the other release's.
    const headings = Array.from(host.querySelectorAll('h2')).map((h) => h.textContent);
    expect(headings).toContain('0.2.33');
    expect(nameInput()).toBeNull();
    expect(host.textContent).toContain('Kontrakty wire jako encje');
    expect(host.textContent).not.toContain('The newer release');
  });

  it('[ac:ac-po-zmianie-nazwy-inline-trasa-detalu] after an inline rename the detail route moves to the new name', async () => {
    state.releases.set('0.2.33', release(1, '0.2.33', 'Kontrakty wire jako encje'));
    const router = await open('/releases/0.2.33');

    const input = nameInput();
    expect(input).not.toBeNull();
    expect(input!.value).toBe('0.2.33');

    // Type the new name and leave the field (blur saves it).
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '0.2.33-final');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();

    expect(state.updates).toEqual([{ releaseName: '0.2.33', name: '0.2.33-final' }]);
    // The open route follows the rename — replaced, not pushed: the old name is no longer an address.
    expect(router.state.location.pathname).toBe('/releases/0.2.33-final');
    expect(router.history.length).toBe(1);
    expect(state.forgotten).toEqual(['0.2.33']);
    // The screen now reads the release under its new name.
    expect(state.asked[state.asked.length - 1]).toBe('0.2.33-final');
    expect(nameInput()?.value).toBe('0.2.33-final');
  });
});
