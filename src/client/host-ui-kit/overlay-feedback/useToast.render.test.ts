// @vitest-environment happy-dom
/**
 * 2.1.20 (M34 `m34l12sc`, `wbs9m5zj`, `l0i0c5wm`) — `useToast` from
 * `@c4s/plugin-runtime/ui` is a thin layer over the shell's `toast` facade:
 * a call goes onto the host toast bus (`c4s:toast`) and the toast appears in
 * the host's ONE stack — the controlled `ToastViewport` that `ToastHost`
 * renders. The plugin mounts no `ToastViewport` of its own.
 *
 * `useToast` is imported from the browser half of `/ui`
 * (`runtime/plugin-runtime-ui.ts`) — the module a plugin's
 * `import "@c4s/plugin-runtime/ui"` resolves to through the import map.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import * as uiBrowserLeg from '../../runtime/plugin-runtime-ui.js';
import { ToastHost } from '../../ui/ToastHost.js';
import { UI_EVENTS, toast } from '../../ui/events.js';
import { UI_KIT_CATALOG, STABLE_UI_KIT_COMPONENTS } from '../registry.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ToastHandle = ReturnType<typeof uiBrowserLeg.useToast>;

let hostEl: HTMLDivElement;
let hostRoot: Root;
let pluginEl: HTMLDivElement;
let pluginRoot: Root;
let busEvents: Array<Record<string, unknown>>;
const recordBus = (e: Event) => busEvents.push((e as CustomEvent).detail as Record<string, unknown>);

async function flush() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** A plugin component that grabs the `/ui` handle, the way plugin code does. */
async function mountPlugin(): Promise<ToastHandle> {
  let handle: ToastHandle | null = null;
  function PluginView() {
    const t = uiBrowserLeg.useToast();
    useEffect(() => {
      handle = t;
    });
    return createElement('div', { 'data-plugin-view': '' }, 'plugin');
  }
  await act(async () => {
    pluginRoot.render(createElement(PluginView));
  });
  expect(handle).not.toBeNull();
  return handle!;
}

const shownIn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[role="status"]')).map((n) => n.textContent ?? '');

beforeEach(async () => {
  busEvents = [];
  window.addEventListener(UI_EVENTS.TOAST, recordBus);
  hostEl = document.createElement('div');
  pluginEl = document.createElement('div');
  document.body.append(hostEl, pluginEl);
  hostRoot = createRoot(hostEl);
  pluginRoot = createRoot(pluginEl);
  // The shell mounts its ToastHost once; the plugin mounts only its own view.
  await act(async () => {
    hostRoot.render(createElement(ToastHost));
  });
});

afterEach(async () => {
  window.removeEventListener(UI_EVENTS.TOAST, recordBus);
  await act(async () => {
    pluginRoot.unmount();
    hostRoot.unmount();
  });
  hostEl.remove();
  pluginEl.remove();
});

describe('[ac:ac-toast-wywolany-przez-usetoast-z-c4s-p] useToast from /ui lands in the host toast stack', () => {
  it('[ac:ac-toast-wywolany-przez-usetoast-z-c4s-p] a toast fired through useToast() from @c4s/plugin-runtime/ui appears in the stack ToastHost renders, with no ToastViewport mounted by the plugin', async () => {
    const t = await mountPlugin();
    expect(shownIn(hostEl)).toEqual([]);

    await act(async () => {
      t.success('Gadget saved');
    });
    await flush();

    // The toast is in the HOST's stack…
    const shown = shownIn(hostEl);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('Gadget saved');
    // …and nowhere in the plugin's tree: the plugin rendered no viewport.
    expect(pluginEl.querySelectorAll('[role="status"]')).toHaveLength(0);
    // Exactly one toast stack on screen.
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('[ac:ac-toast-wywolany-przez-usetoast-z-c4s-p] the handle sends through the shell toast facade onto the host bus (c4s:toast), the same bus the shell toast uses, and shares one stack with it', async () => {
    const t = await mountPlugin();
    const action = { label: 'Undo', onClick: () => {} };

    await act(async () => {
      t.error('Gadget failed', action);
    });
    // The shell's own facade lands in the same stack.
    await act(async () => {
      toast.warning('Shell warning');
    });
    await flush();

    expect(busEvents).toHaveLength(2);
    expect(busEvents[0]).toMatchObject({ variant: 'error', message: 'Gadget failed', action });
    expect(busEvents[1]).toMatchObject({ variant: 'warning', message: 'Shell warning' });

    const shown = shownIn(hostEl);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain('Gadget failed');
    expect(shown[0]).toContain('Undo');
    expect(shown[1]).toContain('Shell warning');
  });

  it('[ac:ac-toast-wywolany-przez-usetoast-z-c4s-p] a ToastViewport mounted without toasts is no second stack: useToast toasts appear only in the host stack', async () => {
    const t = await mountPlugin();
    const bareEl = document.createElement('div');
    document.body.appendChild(bareEl);
    const bareRoot = createRoot(bareEl);
    try {
      await act(async () => {
        bareRoot.render(createElement(uiBrowserLeg.ToastViewport));
      });
      await act(async () => {
        t.warning('Only once');
      });
      await flush();
      expect(shownIn(hostEl)).toHaveLength(1);
      expect(bareEl.querySelectorAll('[role="status"]')).toHaveLength(0);
      expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    } finally {
      await act(async () => {
        bareRoot.unmount();
      });
      bareEl.remove();
    }
  });
});

describe('[ac:ac-toastviewport-usetoast-grupa-overlay] ToastViewport (Feedback) + useToast (beside the catalog)', () => {
  it('[ac:ac-toastviewport-usetoast-grupa-overlay] ToastViewport is an experimental entry of group feedback; useToast is a /ui export beside the catalog, not an entry, and neither is in the stable (hostApiVersion) list', () => {
    const viewport = UI_KIT_CATALOG.find((e) => e.name === 'ToastViewport');
    expect(viewport).toMatchObject({ group: 'feedback', stability: 'experimental', binding: 'presentational' });
    expect(UI_KIT_CATALOG.map((e) => e.name)).not.toContain('useToast');
    expect(typeof uiBrowserLeg.useToast).toBe('function');
    expect(uiBrowserLeg.ToastViewport).toBeDefined();
    expect(STABLE_UI_KIT_COMPONENTS).not.toContain('ToastViewport');
    expect(STABLE_UI_KIT_COMPONENTS).not.toContain('useToast');
  });

  it('[ac:ac-toastviewport-usetoast-grupa-overlay] the imperative handle exposes exactly success/error/warning, and each renders over --z-toast', async () => {
    const t = await mountPlugin();
    expect(Object.keys(t).sort()).toEqual(['error', 'success', 'warning']);

    await act(async () => {
      t.success('ok');
      t.error('bad');
      t.warning('careful');
    });
    await flush();

    const shown = shownIn(hostEl);
    expect(shown).toHaveLength(3);
    expect(shown[0]).toContain('ok');
    expect(shown[1]).toContain('bad');
    expect(shown[2]).toContain('careful');
    expect(busEvents.map((d) => d.variant)).toEqual(['success', 'error', 'warning']);

    // The stack the host renders is the catalog ToastViewport, laid over --z-toast.
    const markup = renderToStaticMarkup(
      createElement(uiBrowserLeg.ToastViewport, {
        toasts: [{ id: 1, kind: 'success', message: 'ok' }],
      }),
    );
    expect(markup).toContain('z-index:var(--z-toast)');
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_DIR = join(HERE, '..');

function kitSources(dir: string): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...kitSources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push({ file: full, src: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

describe('[section:wbs9m5zj] ToastViewport is a controlled stack; useToast keeps no queue of its own', () => {
  it('[section:wbs9m5zj] the viewport renders exactly the toasts it is given and reports a close through onDismiss without dropping the toast itself', async () => {
    const onDismiss = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const r = createRoot(el);
    try {
      await act(async () => {
        r.render(
          createElement(uiBrowserLeg.ToastViewport, {
            toasts: [
              { id: 'a', kind: 'success', message: 'First' },
              { id: 'b', kind: 'info', message: 'Second' },
            ],
            onDismiss,
          }),
        );
      });
      expect(shownIn(el)).toHaveLength(2);
      const close = el.querySelectorAll<HTMLButtonElement>('button[aria-label="Dismiss"]')[1]!;
      await act(async () => {
        close.click();
      });
      expect(onDismiss).toHaveBeenCalledWith('b');
      // Controlled: the caller owns the stack, so nothing vanishes until it says so.
      expect(shownIn(el)).toHaveLength(2);
    } finally {
      await act(async () => {
        r.unmount();
      });
      el.remove();
    }
  });

  it('[section:wbs9m5zj] the kit has no toast bus, queue or timers of its own: the toast stack and its timers live only in ToastHost', () => {
    const sources = kitSources(KIT_DIR);
    for (const { file, src } of sources) {
      expect(src, file).not.toMatch(/c4s-ui:toast/);
    }
    const viewport = readFileSync(join(HERE, 'ToastViewport.tsx'), 'utf8');
    expect(viewport).not.toMatch(/addEventListener|setTimeout|useState/);
    const hook = readFileSync(join(HERE, 'useToast.ts'), 'utf8');
    expect(hook).not.toMatch(/addEventListener|dispatchEvent|setTimeout|useState/);
  });
});

describe('[section:l0i0c5wm] useToast contract — sent through the shell toast facade, no info, no duration', () => {
  it('[section:l0i0c5wm] useToast sends via the shell toast facade (one bus), carries the action, and has no info kind and no duration', async () => {
    const hook = readFileSync(join(HERE, 'useToast.ts'), 'utf8');
    expect(hook).toMatch(/import \{ toast \} from '\.\.\/\.\.\/ui\/events\.js'/);

    const t = await mountPlugin();
    expect(t).not.toHaveProperty('info');
    const action = { label: 'Retry', onClick: vi.fn() };
    await act(async () => {
      t.success('Synced', action);
    });
    await flush();
    expect(busEvents).toHaveLength(1);
    expect(busEvents[0]).toEqual({ variant: 'success', message: 'Synced', action });
    expect(busEvents[0]).not.toHaveProperty('durationMs');
    // The action renders on the host stack and calls back into the plugin.
    const btn = Array.from(hostEl.querySelectorAll('button')).find((b) => b.textContent === 'Retry')!;
    await act(async () => {
      btn.click();
    });
    expect(action.onClick).toHaveBeenCalledTimes(1);
  });
});

describe('[section:m34l12sc] useToast is a thin layer over the shell toast facade, exported beside the catalog', () => {
  it('[section:m34l12sc] /ui exports useToast beside the registry, and a useToast call reaches the same host stack as the shell toast facade', async () => {
    expect(UI_KIT_CATALOG.map((e) => e.name)).not.toContain('useToast');
    expect(uiBrowserLeg).toHaveProperty('useToast');
    const t = await mountPlugin();
    await act(async () => {
      t.warning('From plugin');
      toast.success('From shell');
    });
    await flush();
    expect(busEvents.map((d) => d.message)).toEqual(['From plugin', 'From shell']);
    const shown = shownIn(hostEl);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain('From plugin');
    expect(shown[1]).toContain('From shell');
  });
});
