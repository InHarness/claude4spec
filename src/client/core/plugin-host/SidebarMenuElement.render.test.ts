// @vitest-environment happy-dom
/**
 * 2.1.50 (M13 `lbqrd6xh`, `4ckqwi8t`) — the Sidebar menu element of the
 * `#entities` card: the editor's actions land in the card's draft, the card's
 * shared [Save] sends the whole menu (the types that stood unplaced at the end
 * included), and the sidebar on the same page shows the saved layout at once.
 *
 * Rendered for real: the `#entities` card as the host declares it
 * (`SettingsCardFrame` over `PLUGIN_HOST_SETTINGS`) beside the sidebar's
 * ELEMENTS section fed by `useElementsMenuLayout`, both on one query cache.
 * Only the network (`fetch`) and the router's `Link`/`useRouter` are stubbed;
 * no test saves the Entity types, so the activation refresh never runs.
 * The server half — what `PATCH /config` writes to the file — is pinned in
 * `src/server/routes/config.route.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileText, Tag } from 'lucide-react';
import type { PluginActivationState } from '../../../shared/plugin-host/types.js';
import type { ElementsMenuEntry } from '../../../shared/elements-menu.js';
import type { ConfigResponse } from '../../lib/api.js';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useRouter: () => ({}),
    Link: ({ to, children, title }: { to: string; children?: ReactNode; title?: string }) =>
      createElement('a', { href: to, title }, children),
  };
});

import { SettingsCardFrame } from '../../components/settings/SettingsCardFrame.js';
import { assembleSettings } from '../../components/settings/registry.js';
import { SidebarElements } from '../../components/Sidebar.js';
import { useConfig, useElementsMenuLayout } from '../../hooks/useConfig.js';
import { PLUGIN_HOST_SETTINGS } from './pluginSettings.js';
import { GROUP_ICONS } from './elements-menu.js';
import { clientPluginHost } from './host.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import type { FrontendModule } from './types.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Noop = (() => null) as unknown as FrontendModule['renderChip'];

const moduleOf = (type: string, label: string, order: number): FrontendModule =>
  ({
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: type,
    pathPrefix: `/${type}s`,
    renderChip: Noop,
    renderCard: Noop,
    renderOverlay: Noop,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
    sidebarTab: { icon: order % 20 ? FileText : Tag, label, order },
  }) as unknown as FrontendModule;

// Default order: Alpha(10) < Bravo(20) < Charlie(30). `sm-off` is registered but inactive.
clientPluginHost.registerFrontendModule(moduleOf('sm-alpha', 'Alpha', 10));
clientPluginHost.registerFrontendModule(moduleOf('sm-bravo', 'Bravo', 20));
clientPluginHost.registerFrontendModule(moduleOf('sm-charlie', 'Charlie', 30));
clientPluginHost.registerFrontendModule(moduleOf('sm-off', 'Off', 5));

const ACTIVATION: PluginActivationState = {
  active: ['sm-alpha', 'sm-bravo', 'sm-charlie'],
  inactive: ['sm-off'],
  unknown: [],
} as unknown as PluginActivationState;

const configWith = (elementsMenu: ElementsMenuEntry[] | undefined): ConfigResponse =>
  ({
    name: 'demo',
    configHash: 'h',
    agent: {},
    // The Entity types draft: the three active types ticked.
    entities: ['sm-alpha', 'sm-bravo', 'sm-charlie'],
    ...(elementsMenu ? { elementsMenu } : {}),
  }) as unknown as ConfigResponse;

let host: HTMLDivElement;
let root: Root;
/** Every PATCH body the card sent, in order. */
let patches: Array<Record<string, unknown>>;
let stored: ConfigResponse;

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  patches = [];
  clientPluginHost.applyActivation(ACTIVATION);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/config') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push(body);
        // What the server answers: the body merged in, a `null` removing its key.
        const next = { ...stored } as Record<string, unknown>;
        for (const [k, v] of Object.entries(body)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        stored = next as unknown as ConfigResponse;
        return json(stored);
      }
      if (url.endsWith('/config')) return json(stored);
      if (url.includes('_meta/entities')) return json(ACTIVATION);
      return json({});
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

const [ENTITIES_CARD] = assembleSettings([PLUGIN_HOST_SETTINGS]).filter((c) => c.decl.anchor === 'entities');

/** The settings page's `#entities` card and the shell's ELEMENTS section, on one page. */
function Page() {
  const { data } = useConfig();
  const layout = useElementsMenuLayout();
  return createElement(
    'div',
    null,
    createElement(
      'nav',
      { 'data-sidebar': '' },
      createElement(SidebarElements, {
        entityCounts: {},
        pathname: '/',
        elementsMenu: layout.layout,
        layoutPending: !layout.ready,
      }),
    ),
    data ? createElement(SettingsCardFrame, { card: ENTITIES_CARD!, config: data }) : null,
  );
}

async function render(elementsMenu: ElementsMenuEntry[] | undefined) {
  stored = configWith(elementsMenu);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['config'], stored);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Page)));
  });
  await flush();
}

const editor = () => host.querySelector<HTMLElement>('[data-testid="sidebar-menu-editor"]')!;
const button = (label: string) => editor().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
async function click(label: string) {
  const b = button(label);
  expect(b, `button "${label}"`).not.toBeNull();
  await act(async () => {
    b!.click();
  });
}
async function save() {
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[data-testid="settings-save-entities"]')!.click();
  });
  await flush();
}
const lastMenu = () => patches[patches.length - 1]!.elementsMenu;
/** The ELEMENTS entries of the sidebar, by title. */
const sidebar = () =>
  Array.from(host.querySelector('[data-sidebar] [data-elements-list]')!.children)
    .filter((el) => el.tagName === 'A' || el.tagName === 'BUTTON')
    .map((el) => el.getAttribute('title'));
const treeTypes = () =>
  Array.from(editor().querySelectorAll('[data-menu-tree] [data-menu-type]')).map((el) => el.getAttribute('data-menu-type'));
const hiddenTypes = () =>
  Array.from(editor().querySelectorAll('[data-menu-hidden-type]')).map((el) => el.getAttribute('data-menu-hidden-type'));

describe('Sidebar menu element on #entities (M13 lbqrd6xh)', () => {
  it('[section:4ckqwi8t] sits on the #entities card after Entity types, saved by the card\'s [Save] with the "Applies immediately." message', async () => {
    expect(ENTITIES_CARD!.elements.map((e) => [e.id, e.weight, e.kind])).toEqual([
      ['entity-types', 10, 'multiselect'],
      ['sidebar-menu', 20, 'custom'],
    ]);
    const decl = ENTITIES_CARD!.elements[1]!;
    expect(decl.label).toBe('Sidebar menu');
    expect(decl.keys).toEqual([['elementsMenu']]);
    expect(decl.effectMessage).toBe('Applies immediately.');
    expect(decl.help).toBe(
      'Arrange entity types and groups in any order, or hide a type from the sidebar. Hidden types stay active. Types you have not placed appear at the end.',
    );

    // No key: the flat default list, nothing hidden.
    await render(undefined);
    expect(treeTypes()).toEqual(['sm-alpha', 'sm-bravo', 'sm-charlie']);
    expect(hiddenTypes()).toEqual([]);
    expect(editor().textContent).toContain(decl.help as string);
  });

  it('[section:lbqrd6xh] groups are created, named, given an icon from the closed list, filled, reordered and deleted; hidden types are restored at the end of the tree', async () => {
    await render(undefined);
    const textButton = (text: string) =>
      Array.from(editor().querySelectorAll('button')).find((b) => b.textContent === text)!;
    const select = (label: string) => editor().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    async function choose(label: string, value: string) {
      await act(async () => {
        const el = select(label);
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    const saveButton = () => host.querySelector<HTMLButtonElement>('[data-testid="settings-save-entities"]')!;

    await act(async () => {
      textButton('New group').click();
    });
    // A new group has no type yet: the error stands at its type list and holds [Save].
    const group = () => editor().querySelector<HTMLElement>('[data-menu-group]')!;
    expect(group().getAttribute('data-menu-group')).toBe('New group');
    expect(group().querySelector('[data-menu-group-types] [role="alert"]')!.textContent).toBe(
      'group "New group" must contain at least one type',
    );
    expect(saveButton().disabled).toBe(true);

    // Name it.
    await act(async () => {
      const input = editor().querySelector<HTMLInputElement>('input[aria-label="Group label"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'API');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(group().getAttribute('data-menu-group')).toBe('API');

    // The icon comes from the closed list of group icons (rule 7), or the default.
    expect(Array.from(select('Group icon').options).map((o) => o.value)).toEqual(['', ...Object.keys(GROUP_ICONS)]);
    await choose('Group icon', 'globe');

    // Move two types into the group (by its index in the list), then reorder inside it.
    await choose('Move Alpha to', '3');
    await choose('Move Charlie to', '2');
    expect(treeTypes()).toEqual(['sm-bravo', 'sm-alpha', 'sm-charlie']);
    await act(async () => {
      group().querySelector<HTMLButtonElement>('[data-menu-type="sm-charlie"] button[aria-label="Move up"]')!.click();
    });
    expect(group().querySelector('[role="alert"]')).toBeNull();
    await save();
    expect(lastMenu()).toEqual([{ type: 'sm-bravo' }, { group: 'API', icon: 'globe', types: ['sm-charlie', 'sm-alpha'] }]);

    // Delete the group: its types return to the top level in its place.
    await click('Delete group API');
    expect(treeTypes()).toEqual(['sm-bravo', 'sm-charlie', 'sm-alpha']);
    // Hide a type, then restore it — it comes back at the end of the tree.
    await click('Hide Bravo');
    expect(hiddenTypes()).toEqual(['sm-bravo']);
    await click('Restore Bravo');
    expect(hiddenTypes()).toEqual([]);
    expect(treeTypes()).toEqual(['sm-charlie', 'sm-alpha', 'sm-bravo']);
    await save();
    expect(lastMenu()).toEqual([{ type: 'sm-charlie' }, { type: 'sm-alpha' }, { type: 'sm-bravo' }]);
  });

  it('[section:lbqrd6xh] a type a merge left twice in the file stands once (its first occurrence) and does not hold [Save] after an edit', async () => {
    // Alpha at the top level and in G; Bravo in G and as a hidden entry — both break rule 5.
    await render([
      { type: 'sm-alpha' },
      { group: 'G', types: ['sm-alpha', 'sm-bravo'] },
      { type: 'sm-bravo', hidden: true },
    ]);
    // First occurrence wins, as in the sidebar: Alpha at the top, Bravo in G, nothing hidden.
    expect(treeTypes()).toEqual(['sm-alpha', 'sm-bravo', 'sm-charlie']);
    expect(
      Array.from(editor().querySelectorAll('[data-menu-group="G"] [data-menu-type]')).map((el) =>
        el.getAttribute('data-menu-type'),
      ),
    ).toEqual(['sm-bravo']);
    expect(hiddenTypes()).toEqual([]);

    await click('Hide Charlie');
    // No rule-5 error, [Save] is free.
    expect(editor().querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-testid="settings-save-entities"]')!.disabled).toBe(false);
    await save();
    expect(lastMenu()).toEqual([
      { type: 'sm-alpha' },
      { group: 'G', types: ['sm-bravo'] },
      { type: 'sm-charlie', hidden: true },
    ]);
  });

  it("[section:lbqrd6xh] after Move up the focus stays on the moved row's Move up, so a keyboard user can press it again", async () => {
    await render([{ type: 'sm-alpha' }, { group: 'G', types: ['sm-bravo'] }, { type: 'sm-charlie' }]);
    const active = () => document.activeElement as HTMLElement | null;
    async function pressFocused() {
      await act(async () => {
        (document.activeElement as HTMLButtonElement).click();
      });
    }

    // A type row, moved up twice by pressing the focused button; the row is not remounted.
    const charlie = editor().querySelector('[data-menu-type="sm-charlie"]')!;
    const charlieUp = () => charlie.querySelector<HTMLButtonElement>('button[aria-label="Move up"]')!;
    charlieUp().focus();
    expect(active()).toBe(charlieUp());
    await pressFocused();
    expect(treeTypes()).toEqual(['sm-alpha', 'sm-charlie', 'sm-bravo']);
    expect(editor().querySelector('[data-menu-type="sm-charlie"]')).toBe(charlie);
    expect(active()).toBe(charlieUp());
    await pressFocused();
    expect(treeTypes()).toEqual(['sm-charlie', 'sm-alpha', 'sm-bravo']);
    expect(editor().querySelector('[data-menu-type="sm-charlie"]')).toBe(charlie);
    // At the top Move up is disabled: the focus goes to the row's Move down instead of being lost.
    expect(charlieUp().disabled).toBe(true);
    expect(active()).toBe(charlie.querySelector('button[aria-label="Move down"]'));

    // A group row (keyed by its editor id, not its index): the same, twice in a row.
    const group = editor().querySelector('[data-menu-group="G"]')!;
    const groupUp = () => group.firstElementChild!.querySelector<HTMLButtonElement>('button[aria-label="Move up"]')!;
    groupUp().focus();
    await pressFocused();
    expect(treeTypes()).toEqual(['sm-charlie', 'sm-bravo', 'sm-alpha']);
    expect(editor().querySelector('[data-menu-group="G"]')).toBe(group);
    expect(active()).toBe(groupUp());
    await pressFocused();
    expect(treeTypes()).toEqual(['sm-bravo', 'sm-charlie', 'sm-alpha']);
    expect(editor().querySelector('[data-menu-group="G"]')).toBe(group);
    expect(groupUp().disabled).toBe(true);
    expect(active()).toBe(group.firstElementChild!.querySelector('button[aria-label="Move down"]'));

    await save();
    expect(lastMenu()).toEqual([{ group: 'G', types: ['sm-bravo'] }, { type: 'sm-charlie' }, { type: 'sm-alpha' }]);
  });

  it('[ac:ac-ukrycie-typu-zgrupowanego-w-edytorze] hiding a grouped type in the Sidebar menu editor takes it out of its group', async () => {
    await render([{ group: 'API', types: ['sm-alpha', 'sm-bravo'] }]);
    const groupTypes = () =>
      Array.from(editor().querySelectorAll('[data-menu-group="API"] [data-menu-type]')).map((el) =>
        el.getAttribute('data-menu-type'),
      );
    expect(groupTypes()).toEqual(['sm-alpha', 'sm-bravo']);

    await click('Hide Alpha');
    // Out of the group, into the Hidden list.
    expect(groupTypes()).toEqual(['sm-bravo']);
    expect(hiddenTypes()).toEqual(['sm-alpha']);

    await save();
    // The whole menu is saved — Charlie, unplaced before, included; Alpha is a
    // hidden type entry and no group lists it.
    expect(lastMenu()).toEqual([
      { group: 'API', types: ['sm-bravo'] },
      { type: 'sm-charlie' },
      { type: 'sm-alpha', hidden: true },
    ]);
    const menu = lastMenu() as ElementsMenuEntry[];
    expect(menu.some((e) => 'group' in e && e.types.includes('sm-alpha'))).toBe(false);
  });

  it('[ac:ac-slug-nieaktywnego-typu-zostaje-w-elem] an inactive type\'s slug stays in elementsMenu after a save of the #entities card', async () => {
    await render([{ type: 'sm-off' }, { type: 'sm-bravo' }, { group: 'G', types: ['sm-gone', 'sm-alpha'] }]);
    // Shown greyed, by its slug.
    const off = editor().querySelector<HTMLElement>('[data-menu-type="sm-off"]')!;
    expect(off.getAttribute('data-greyed')).toBe('true');
    expect(off.textContent).toContain('sm-off');
    expect(off.textContent).not.toContain('Off');

    // An unrelated edit, then the card's [Save].
    await act(async () => {
      editor().querySelector<HTMLButtonElement>('[data-menu-type="sm-bravo"] button[aria-label="Move up"]')!.click();
    });
    await save();
    expect(lastMenu()).toEqual([
      { type: 'sm-bravo' },
      { type: 'sm-off' },
      { group: 'G', types: ['sm-gone', 'sm-alpha'] },
      { type: 'sm-charlie' },
    ]);
  });

  it('[ac:ac-usuniety-w-edytorze-sidebar-menu-wpis] an inactive entry removed in the Sidebar menu editor is gone from the file after a save of the #entities card', async () => {
    await render([{ type: 'sm-off' }, { group: 'G', types: ['sm-alpha', 'sm-gone'] }, { type: 'sm-bravo' }]);
    // Only inactive / unknown slugs are removable — an active type is not.
    expect(button('Remove Alpha')).toBeNull();
    expect(button('Remove sm-off')).not.toBeNull();

    await click('Remove sm-off');
    await click('Remove sm-gone');
    expect(editor().querySelector('[data-menu-type="sm-off"]')).toBeNull();

    await save();
    expect(lastMenu()).toEqual([{ group: 'G', types: ['sm-alpha'] }, { type: 'sm-bravo' }, { type: 'sm-charlie' }]);
    expect(JSON.stringify(stored.elementsMenu)).not.toContain('sm-off');
    expect(JSON.stringify(stored.elementsMenu)).not.toContain('sm-gone');
  });

  it('[ac:ac-reset-to-default-order-usuwa-klucz-el] Reset to default order sends the removal of the elementsMenu key with the #entities card\'s save', async () => {
    await render([{ group: 'API', types: ['sm-charlie'] }, { type: 'sm-alpha', hidden: true }]);
    // The reset button is a labelled button, not an icon button.
    const reset = Array.from(editor().querySelectorAll('button')).find((b) => b.textContent === 'Reset to default order')!;
    await act(async () => {
      reset.click();
    });
    // The editor falls back to the flat default list, nothing hidden.
    expect(treeTypes()).toEqual(['sm-alpha', 'sm-bravo', 'sm-charlie']);
    expect(hiddenTypes()).toEqual([]);

    await save();
    expect(patches).toEqual([{ elementsMenu: null }]);
    expect('elementsMenu' in stored).toBe(false);
  });

  it('[ac:ac-po-zapisie-karty-entities-sidebar-pok] after a save of the #entities card the sidebar shows the new ELEMENTS layout without a page reload', async () => {
    await render([{ type: 'sm-charlie' }]);
    expect(sidebar()).toEqual(['Charlie', 'Alpha', 'Bravo']);

    await click('Hide Charlie');
    // The tree is Alpha, Bravo now: Bravo moves up.
    await act(async () => {
      editor().querySelector<HTMLButtonElement>('[data-menu-type="sm-bravo"] button[aria-label="Move up"]')!.click();
    });
    // A draft is not the sidebar's business.
    expect(sidebar()).toEqual(['Charlie', 'Alpha', 'Bravo']);

    await save();
    expect(lastMenu()).toEqual([{ type: 'sm-charlie', hidden: true }, { type: 'sm-bravo' }, { type: 'sm-alpha' }]);
    // Same page, same mount — the sidebar follows the save.
    expect(sidebar()).toEqual(['Bravo', 'Alpha']);
  });
});
