// @vitest-environment happy-dom
/**
 * 2.1.20 (M50 `tbeatf5z`, `l5pregst`, `l5pextnd`, `77rzi036`) — the shell's four
 * window facades on the browser leg of `@c4s/plugin-runtime`, seen from a
 * plugin.
 *
 * In the browser a plugin's bare `@c4s/plugin-runtime` resolves through the
 * import map to the shim over this very module (`./plugin-runtime.ts`). The
 * runner's alias would send it to the Node barrel instead, so the mock below
 * plays the import map: the specifier resolves to the browser leg itself. The
 * plugin code exercised is a real first-party envelope's (`c4s-plugin-api-contracts`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@c4s/plugin-runtime', async () => await import('./plugin-runtime.js'));

import * as browserLeg from './plugin-runtime.js';
import * as hostFacades from '../ui/events.js';
import { UI_EVENTS } from '../ui/events.js';
import { ConfirmLayer } from '../ui/ConfirmModal.js';
import { ToastHost } from '../ui/ToastHost.js';

/**
 * The bare specifier and the envelope module are named through variables: the
 * client's own compile does not resolve `@c4s/plugin-runtime` (the envelope's
 * tsconfig does), so neither is part of this file's static import graph.
 */
const RUNTIME_SPECIFIER = '@c4s/plugin-runtime';
const DTO_DELETE_CONFIRM = '../../../plugins/c4s-plugin-api-contracts/src/entity/dto/frontend/delete-confirm.js';
type ConfirmAndDeleteDto = (
  dto: { slug: string; title: string },
  remove: (slug: string) => Promise<unknown>,
) => Promise<boolean>;
let confirmAndDeleteDto: ConfirmAndDeleteDto;
beforeAll(async () => {
  // Loaded once, up front, so a test's window opens within its own flush.
  const mod = (await import(/* @vite-ignore */ DTO_DELETE_CONFIRM)) as { confirmAndDeleteDto: ConfirmAndDeleteDto };
  confirmAndDeleteDto = mod.confirmAndDeleteDto;
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let windowEvents: Array<{ type: string; detail: Record<string, unknown> }>;
const record = (e: Event) =>
  windowEvents.push({ type: e.type, detail: (e as CustomEvent).detail as Record<string, unknown> });

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) ?? null;
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.click();
  });
  await flush();
};
const confirmWindow = () => host.querySelector<HTMLElement>('[data-modal-kind]');

beforeEach(async () => {
  windowEvents = [];
  for (const type of Object.values(UI_EVENTS)) window.addEventListener(type, record);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(ConfirmLayer));
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  for (const type of Object.values(UI_EVENTS)) window.removeEventListener(type, record);
});

const PLUGINS = join(import.meta.dirname, '../../../plugins');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const pluginSources = () =>
  readdirSync(PLUGINS)
    .filter((d) => statSync(join(PLUGINS, d, 'src'), { throwIfNoEntry: false })?.isDirectory())
    .flatMap((d) => sourceFiles(join(PLUGINS, d, 'src')));

describe('[ac:ac-plugin-otwiera-okno-potwierdzenia-prz] a plugin confirms through confirmDestructive of @c4s/plugin-runtime', () => {
  it('[ac:ac-plugin-otwiera-okno-potwierdzenia-prz] the plugin\'s confirmDestructive is the host\'s own facade, and the window it asks opens on the host and answers the plugin', async () => {
    const runtime = (await import(/* @vite-ignore */ RUNTIME_SPECIFIER)) as typeof browserLeg;
    // What the plugin imported is the shell's function, not a copy in its bundle.
    expect(runtime.confirmDestructive).toBe(hostFacades.confirmDestructive);

    const removed: string[] = [];
    const pending = confirmAndDeleteDto({ slug: 'user-response', title: 'UserResponse' }, async (slug) => {
      removed.push(slug);
    });
    await flush();

    // The host's destructive-confirm window is on screen, under the plugin's kind.
    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('dto-delete');
    expect(host.textContent).toContain('Delete DTO?');
    expect(host.textContent).toContain('Delete DTO UserResponse? All references to this DTO will become broken.');

    await click(button('Delete'));
    await expect(pending).resolves.toBe(true);
    expect(removed).toEqual(['user-response']);
    expect(confirmWindow()).toBeNull();
    // Its toast landed on the host's single toast bus.
    expect(windowEvents.filter((e) => e.type === UI_EVENTS.TOAST).map((e) => e.detail.message)).toEqual(['DTO deleted']);
  });

  it('[ac:ac-plugin-otwiera-okno-potwierdzenia-prz] cancelling the window answers false and nothing is deleted', async () => {
    const removed: string[] = [];
    const pending = confirmAndDeleteDto({ slug: 'user-response', title: 'UserResponse' }, async (slug) => {
      removed.push(slug);
    });
    await flush();
    await click(button('Cancel'));
    await expect(pending).resolves.toBe(false);
    expect(removed).toEqual([]);
  });

  it('[ac:ac-plugin-otwiera-okno-potwierdzenia-prz] no first-party plugin emits a host window event — every confirm goes through the facade', () => {
    const files = pluginSources();
    expect(files.length).toBeGreaterThan(0);
    const confirmers: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(PLUGINS, file);
      // No host window event is named, constructed or dispatched by a plugin.
      for (const event of Object.values(UI_EVENTS)) expect(src, `${rel} names ${event}`).not.toContain(event);
      expect(src, `${rel} constructs a CustomEvent`).not.toMatch(/new CustomEvent\(/);
      expect(src, `${rel} dispatches a window event`).not.toMatch(/dispatchEvent\(/);
      if (/\bconfirmDestructive\(/.test(src)) {
        confirmers.push(rel);
        expect(src, `${rel} imports confirmDestructive from @c4s/plugin-runtime`).toMatch(
          /import \{[^}]*\bconfirmDestructive\b[^}]*\} from '@c4s\/plugin-runtime';/,
        );
      }
    }
    // The envelopes that delete through a confirmation window.
    expect(confirmers.length).toBeGreaterThanOrEqual(5);
  });
});

describe('[section:tbeatf5z] the four window facades exposed to plugins', () => {
  it('[section:tbeatf5z] openPopover, openModal, confirmDestructive and toast on the browser leg are the host\'s own functions', () => {
    expect(browserLeg.openPopover).toBe(hostFacades.openPopover);
    expect(browserLeg.openModal).toBe(hostFacades.openModal);
    expect(browserLeg.confirmDestructive).toBe(hostFacades.confirmDestructive);
    expect(browserLeg.toast).toBe(hostFacades.toast);
    expect(typeof browserLeg.toast.success).toBe('function');
    expect(typeof browserLeg.toast.error).toBe('function');
    expect(typeof browserLeg.toast.warning).toBe('function');
  });
});

describe('[section:l5pregst] the facade signatures a plugin calls', () => {
  it('[section:l5pregst] confirmDestructive takes the extended options — confirmLabel, cancelLabel, danger, requireText and action', async () => {
    const actions: string[] = [];
    const pending = browserLeg.confirmDestructive('acme-gadget-purge', {
      title: 'Purge gadgets?',
      body: 'Every gadget goes.',
      confirmLabel: 'Purge',
      cancelLabel: 'Keep them',
      danger: true,
      requireText: 'gadgets',
      action: async () => {
        actions.push('purged');
        return true;
      },
    });
    await flush();
    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('acme-gadget-purge');
    expect(button('Keep them')).not.toBeNull();
    // Type-to-confirm: Purge stays disabled until the text matches.
    expect(button('Purge')!.disabled).toBe(true);
    const input = host.querySelector<HTMLInputElement>('input[placeholder="gadgets"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'gadgets');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    expect(button('Purge')!.disabled).toBe(false);
    await click(button('Purge'));
    await expect(pending).resolves.toBe(true);
    expect(actions).toEqual(['purged']);
  });

  it('[section:l5pregst] toast.success / error / warning take the message and an optional action', () => {
    const onClick = () => undefined;
    browserLeg.toast.success('Saved', { label: 'Undo', onClick });
    browserLeg.toast.error('Failed');
    browserLeg.toast.warning('Careful', { durationMs: 900 });
    const toasts = windowEvents.filter((e) => e.type === UI_EVENTS.TOAST).map((e) => e.detail);
    expect(toasts).toHaveLength(3);
    expect(toasts[0]).toMatchObject({ variant: 'success', message: 'Saved', action: { label: 'Undo', onClick } });
    expect(toasts[1]).toMatchObject({ variant: 'error', message: 'Failed' });
    expect(toasts[1]).not.toHaveProperty('kind');
    expect(toasts[2]).toMatchObject({ variant: 'warning', message: 'Careful', durationMs: 900 });
  });
});

describe('[section:l5pextnd] plugin kinds in the facades are an open string', () => {
  it('[section:l5pextnd] a kind outside the host\'s kind maps is dispatched as given — no check against the maps', async () => {
    void browserLeg.openPopover('acme-gadget-create', { x: 10, y: 20, preset: 'wide' });
    void browserLeg.openModal('acme-gadget-wizard', { step: 1 });
    void browserLeg.confirmDestructive('acme-gadget-delete', { title: 'Delete gadget?', body: 'Gone for good.' });
    await flush();
    const popover = windowEvents.find((e) => e.type === UI_EVENTS.POPOVER)!.detail;
    expect(popover).toMatchObject({ kind: 'acme-gadget-create', x: 10, y: 20, props: { preset: 'wide' } });
    expect(windowEvents.find((e) => e.type === UI_EVENTS.MODAL)!.detail).toMatchObject({
      kind: 'acme-gadget-wizard',
      props: { step: 1 },
    });
    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('acme-gadget-delete');
    await click(button('Cancel'));
  });
});

describe('[section:wkkqzeum] the Toast facade renders the controlled catalog ToastViewport', () => {
  it('[section:wkkqzeum] a toast from the plugin facade appears on the stack ToastHost hands to the controlled ToastViewport', async () => {
    const toastHost = document.createElement('div');
    document.body.appendChild(toastHost);
    const toastRoot = createRoot(toastHost);
    try {
      await act(async () => {
        toastRoot.render(createElement(ToastHost));
      });
      // Nothing queued — the controlled viewport renders no stack at all.
      expect(toastHost.querySelectorAll('[role="status"]')).toHaveLength(0);
      browserLeg.toast.success('Gadget saved');
      browserLeg.toast.warning('Gadget is large');
      await flush();
      const shown = Array.from(toastHost.querySelectorAll('[role="status"]')).map((el) => el.textContent ?? '');
      expect(shown).toHaveLength(2);
      expect(shown[0]).toContain('Gadget saved');
      expect(shown[1]).toContain('Gadget is large');
    } finally {
      await act(async () => {
        toastRoot.unmount();
      });
      toastHost.remove();
    }
  });
});

describe('[section:77rzi036] one registry of window events; plugins use the facades', () => {
  it('[section:77rzi036] each facade dispatches its registry event, and the browser leg carries no event name a plugin could emit', async () => {
    expect(UI_EVENTS).toEqual({
      TOAST: 'c4s:toast',
      CONFIRM: 'c4s:confirm-open',
      POPOVER: 'c4s:popover-open',
      MODAL: 'c4s:modal-open',
    });
    void browserLeg.openPopover('acme-gadget-create', { x: 0, y: 0 });
    void browserLeg.openModal('acme-gadget-wizard', {});
    void browserLeg.confirmDestructive('acme-gadget-delete', { title: 'Delete?', body: 'Gone.' });
    browserLeg.toast.error('Nope');
    await flush();
    expect(windowEvents.map((e) => e.type)).toEqual([
      UI_EVENTS.POPOVER,
      UI_EVENTS.MODAL,
      UI_EVENTS.CONFIRM,
      UI_EVENTS.TOAST,
    ]);
    // The event names are a host detail: the plugin surface exports none of them.
    for (const value of Object.values(browserLeg)) {
      if (typeof value === 'string') expect(value).not.toMatch(/^c4s:/);
    }
    expect(Object.keys(browserLeg)).not.toContain('UI_EVENTS');
    await click(button('Cancel'));
  });
});
