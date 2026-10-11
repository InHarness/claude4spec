// @vitest-environment happy-dom
/**
 * 2.1.12 (M31 ui-view `welcome-page`, `/welcome`). The workspace registry
 * screen: the workspace's projects listed neutrally, a click loads the
 * project's route, "Add project to workspace" opens the `project-create`
 * window; state `empty` (e.g. after purging the last project) — an empty list
 * and only the add action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const nav = vi.hoisted(() => ({ hrefs: [] as string[] }));
vi.mock('../../lib/document-nav.js', () => ({
  navigateDocument: (href: string) => {
    nav.hrefs.push(href);
  },
}));

import { WelcomePage } from './WelcomePage.js';
import { UI_EVENTS } from '../../ui/events.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let workspace: unknown;
let requests: string[];
let modals: Array<{ kind: string }>;
const onModal = (e: Event) => modals.push((e as CustomEvent).detail);

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => {
    root.render(createElement(WelcomePage));
  });
  await flush();
}

const buttons = () => Array.from(host.querySelectorAll('button'));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label) ?? null;

beforeEach(() => {
  nav.hrefs = [];
  requests = [];
  modals = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(String(url));
      return new Response(JSON.stringify(workspace), { status: 200 });
    }),
  );
  window.addEventListener(UI_EVENTS.MODAL, onModal);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(UI_EVENTS.MODAL, onModal);
  vi.unstubAllGlobals();
});

describe('welcome-page (/welcome)', () => {
  it('[entity:welcome-page] default state: lists the workspace projects neutrally; a click loads /p/<id>/; "Add project to workspace" opens project-create', async () => {
    workspace = {
      name: 'default',
      projects: [
        { id: 'alpha', name: 'Alpha', cwd: '/work/alpha', live: true },
        { id: 'beta', name: 'Beta', cwd: '/work/beta', live: false },
      ],
    };
    await render();

    expect(requests).toEqual(['/api/workspace']);
    expect(host.textContent).toContain('Welcome to claude4spec');
    expect(host.textContent).toContain('default');
    const projectButtons = buttons().filter((b) => b.textContent?.includes('/work/'));
    expect(projectButtons.map((b) => b.textContent)).toEqual(['Alpha/work/alpha', 'Beta/work/beta']);
    // Neutral: no project is marked (no check mark, no accent difference by cwd).
    expect(projectButtons[0]!.outerHTML.replace(/alpha|Alpha/g, 'x')).toBe(
      projectButtons[1]!.outerHTML.replace(/beta|Beta/g, 'x'),
    );
    expect(host.textContent).not.toContain('No projects registered yet');

    await act(async () => {
      projectButtons[1]!.click();
    });
    expect(nav.hrefs).toEqual(['/p/beta/']);

    await act(async () => {
      button('Add project to workspace')!.click();
    });
    expect(modals.map((m) => m.kind)).toEqual(['project-create']);
  });

  it('[entity:welcome-page] state `empty`: the workspace registry has no project — an empty list and only the add-project action', async () => {
    workspace = { name: 'default', projects: [] };
    await render();

    expect(host.textContent).toContain('No projects registered yet — add a directory below.');
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Add project to workspace']);

    await act(async () => {
      button('Add project to workspace')!.click();
    });
    expect(modals.map((m) => m.kind)).toEqual(['project-create']);
    expect(nav.hrefs).toEqual([]);
  });
});
