// @vitest-environment happy-dom
/**
 * 2.1.28 (M33 `m33trst0` + Host UI Kit slice `gox0ptn4`) — the project-local
 * plugins trust gate, rendered for real: the `project-plugins-trust` window is
 * the catalog `Dialog` in its `dismissible={false}` variant — no header ✕, the
 * scrim and Escape do not close it — and its only two exits are catalog
 * `ActionButton`s in the footer, each resolving the facade with the branch the
 * user picked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ActionButtonProps } from '../host-ui-kit/actions/ActionButton.js';
import type { ModalFormProps } from '../ui/ModalHost.js';

const h = vi.hoisted(() => ({
  trustCalls: [] as boolean[],
  actionButtons: [] as ActionButtonProps[],
  opened: [] as Array<{ kind: string; props: unknown; options: unknown }>,
}));

vi.mock('../host-ui-kit/actions/ActionButton.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../host-ui-kit/actions/ActionButton.js')>();
  return {
    ActionButton: (props: ActionButtonProps) => {
      if (props && props.label !== undefined) h.actionButtons.push(props);
      return createElement(real.ActionButton, props);
    },
  };
});
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useQuery: () => ({ data: undefined }),
}));
vi.mock('../core/plugin-host/host.js', () => ({ clientPluginHost: { applyActivation: () => {} } }));
vi.mock('../lib/api.js', () => ({
  ApiError: class ApiError extends Error {},
  metaApi: {
    setTrustPlugins: async (trust: boolean) => {
      h.trustCalls.push(trust);
      return { trust };
    },
    entities: async () => ({}),
    plugins: async () => ({}),
  },
}));
vi.mock('../ui/events.js', () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
  openModal: (kind: string, props: unknown, options: unknown) => {
    h.opened.push({ kind, props, options });
    return Promise.resolve(null);
  },
}));

import { TrustPluginsModal } from './TrustPluginsModal.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.trustCalls = [];
  h.actionButtons = [];
  onClose = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render() {
  const props: ModalFormProps<'project-plugins-trust'> = {
    request: {
      kind: 'project-plugins-trust',
      props: { packages: [{ package: 'evil-plugin', origin: '.claude4spec/plugins/evil', layer: 'overlay' }] },
      dismissible: false,
      onSubmit: () => {},
      onCancel: () => {},
    },
    onClose: onClose as ModalFormProps<'project-plugins-trust'>['onClose'],
  };
  act(() => root.render(createElement(TrustPluginsModal, props)));
}

const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');
const part = (name: string) => host.querySelector<HTMLElement>(`[data-dialog-part="${name}"]`);
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) ?? null;

describe('[section:m33trst0] the project-local trust prompt is a gate that requires an answer', () => {
  it('[section:m33trst0] renders the catalog Dialog with its title and the overlay packages, and no header ✕', () => {
    render();
    expect(dialog()).not.toBeNull();
    expect(part('header')?.textContent).toContain("Trust this project's plugins?");
    expect(part('body')?.textContent).toContain('evil-plugin');
    expect(host.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it('[section:m33trst0] neither a scrim click nor Escape closes it', () => {
    render();
    act(() => {
      dialog()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(h.trustCalls).toEqual([]);
  });

  it('[section:m33trst0] "Trust & load" records trust and resolves the facade with that branch', async () => {
    render();
    await act(async () => {
      button('Trust & load')!.click();
    });
    expect(h.trustCalls).toEqual([true]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith({ trust: true });
  });

  it('[section:m33trst0] "Don\'t trust" is an expressed refusal: it records it and resolves the facade with that branch', async () => {
    render();
    await act(async () => {
      button("Don't trust")!.click();
    });
    expect(h.trustCalls).toEqual([false]);
    expect(onClose).toHaveBeenCalledWith({ trust: false });
  });
});

describe('[section:gox0ptn4] M33 Host UI Kit slice — the trust form consumes the catalog ActionButton', () => {
  it('[section:gox0ptn4] the gate\'s only two buttons are catalog ActionButtons in the Dialog footer (stay on base = ghost, trust = primary)', () => {
    render();
    const labels = h.actionButtons.map((b) => [b.label, b.variant]);
    expect(labels).toContainEqual(["Don't trust", 'ghost']);
    expect(labels).toContainEqual(['Trust & load', 'primary']);
    const footer = part('footer')!;
    const buttons = Array.from(host.querySelectorAll('button'));
    // Exactly the two answers, both in the pinned footer — no other way out.
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Don't trust", 'Trust & load']);
    for (const b of buttons) expect(footer.contains(b)).toBe(true);
  });
});
