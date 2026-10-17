// @vitest-environment happy-dom
/**
 * M31 workspace switcher — a large workspace must not push projects (or the
 * "Add project…" action) past the bottom of the viewport. The popover is
 * height-bounded; only the project list scrolls, the header and "Add project…"
 * stay pinned outside it, and the current project is scrolled into view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../lib/api-core.js', () => ({ PROJECT_ID: 'p-25' }));
vi.mock('../ui/events.js', () => ({ openModal: vi.fn(), toast: { error: vi.fn() } }));

import { ProjectSwitcher } from './ProjectSwitcher.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const projects = Array.from({ length: 30 }, (_, i) => ({
  id: `p-${i}`,
  name: `Project ${i}`,
  cwd: `/work/project-${i}`,
  live: true,
}));

let host: HTMLDivElement;
let root: Root;
let scrolled: Element[];

beforeEach(() => {
  scrolled = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ name: 'default', projects }), { status: 200 })),
  );
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function openSwitcher() {
  await act(async () => {
    root.render(createElement(ProjectSwitcher, { projectName: 'Project 25', cwdPath: '/work/project-25' }));
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="Switch project"]')!.click();
  });
  // Let the /api/workspace fetch resolve and the list render.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('ProjectSwitcher — large workspace', () => {
  it('bounds the popover height and scrolls only the project list', async () => {
    await openSwitcher();

    const listbox = host.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(listbox.style.maxHeight).not.toBe('');

    const list = host.querySelector<HTMLElement>('[data-testid="project-switcher-list"]')!;
    expect(list.className).toContain('overflow-y-auto');
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(30);
  });

  it('keeps "Add project…" outside the scrolling list', async () => {
    await openSwitcher();

    const list = host.querySelector<HTMLElement>('[data-testid="project-switcher-list"]')!;
    const add = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Add project'))!;
    expect(add).toBeTruthy();
    expect(list.contains(add)).toBe(false);
  });

  it('scrolls the current project into view on open', async () => {
    await openSwitcher();

    const current = host.querySelector('[role="option"][aria-selected="true"]')!;
    expect(current.textContent).toContain('Project 25');
    expect(scrolled).toContain(current);
  });
});
