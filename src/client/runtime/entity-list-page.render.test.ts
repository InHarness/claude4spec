// @vitest-environment happy-dom
/**
 * M19 (2.1.28) — the entity-list page pattern and the create-from-list recipe,
 * composed the way a plugin author composes them: every component imported from
 * the module `@c4s/plugin-runtime/ui` resolves to in the browser
 * (`./plugin-runtime-ui.js`, published onto `window.__c4s_shared` and re-exported
 * by the import-map shim). The host and every envelope render the ONE catalog
 * `EntityListHeader` — none carries its own.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { List } from 'lucide-react';
import * as ui from './plugin-runtime-ui.js';
import { EntityListHeader as CatalogEntityListHeader } from '../host-ui-kit/core/EntityListHeader.js';
import { PLUGIN_RUNTIME_EXPORT_NAMES, PLUGIN_RUNTIME_UI_EXPORT_NAMES } from '../../shared/plugin-host/frontend-manifest.js';
import { UI_KIT_STABLE_COMPONENTS } from '../../shared/plugin-host/ui-kit-surface.js';
import { VERSIONED_UI_KIT_COMPONENTS } from '../../shared/plugin-host/host-api.js';
import type * as Published from '../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
/** Source without comments — doc comments legitimately NAME the header. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function sourcesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      sourcesUnder(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const PLUGIN_DIRS = readdirSync(join(REPO, 'plugins')).filter((d) => existsSync(join(REPO, 'plugins', d, 'src')));
const pluginSources = () => PLUGIN_DIRS.flatMap((d) => sourcesUnder(join(REPO, 'plugins', d, 'src')));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = (el: ReactNode) => act(() => root.render(el));

describe('one EntityListHeader for host and plugins (M19/L12, 2.1.28)', () => {
  it('[ac:ac-plugin-renderuje-komponent-entitylisthea] the host list and every plugin list render the catalog EntityListHeader — plugins import it from @c4s/plugin-runtime/ui with React external; no parallel header exists anywhere', () => {
    // Host side: the module `@c4s/plugin-runtime/ui` resolves to IS the catalog component.
    expect(ui.EntityListHeader).toBe(CatalogEntityListHeader);
    expect(PLUGIN_RUNTIME_UI_EXPORT_NAMES).toContain('EntityListHeader');
    const props: Published.EntityListHeaderProps = { icon: List, title: 'Endpoints', count: 2 };
    expect(renderToStaticMarkup(createElement(ui.EntityListHeader, props))).toBe(
      renderToStaticMarkup(createElement(CatalogEntityListHeader, props)),
    );
    expect(read('src/client/runtime/shared-runtime.ts')).toMatch(/'@c4s\/plugin-runtime\/ui': PluginRuntimeUi/);

    // Plugin side: every envelope that names EntityListHeader imports it from `/ui`…
    const users: string[] = [];
    for (const file of pluginSources()) {
      const src = code(readFileSync(file, 'utf8'));
      if (!/\bEntityListHeader\b/.test(src)) continue;
      const rel = relative(REPO, file);
      users.push(rel);
      expect(src, rel).toMatch(/import \{[^}]*\bEntityListHeader\b[^}]*\} from '@c4s\/plugin-runtime\/ui'/);
      expect(src, rel).not.toMatch(/import \{[^}]*\bEntityListHeader\b[^}]*\} from '\.{1,2}\//);
    }
    // …and the plugins' list screens do render it.
    for (const screen of [
      'plugins/c4s-plugin-ac/src/entity/ac/frontend/list-page.tsx',
      'plugins/c4s-plugin-api-contracts/src/entity/dto/frontend/list-page.tsx',
      'plugins/c4s-plugin-api-contracts/src/entity/endpoint/frontend/list-page.tsx',
      'plugins/c4s-plugin-database-tables/src/entity/database-table/frontend/routes.tsx',
      'plugins/c4s-plugin-frontend-mockups/src/frontend-kit/ListPageHeader.tsx',
      'plugins/c4s-plugin-host-ui-kit-components/src/entity/ui-kit-component/frontend/routes.tsx',
    ]) {
      expect(users, screen).toContain(screen);
      expect(code(read(screen)), screen).toMatch(/<EntityListHeader\b/);
    }

    // Without a React copy of their own: every envelope consuming `/ui` keeps React and `/ui` external.
    for (const dir of PLUGIN_DIRS) {
      const consumesUi = sourcesUnder(join(REPO, 'plugins', dir, 'src')).some((f) =>
        /from '@c4s\/plugin-runtime\/ui'/.test(readFileSync(f, 'utf8')),
      );
      if (!consumesUi) continue;
      const vite = read(`plugins/${dir}/vite.config.ts`);
      const external = /const EXTERNAL = \[([\s\S]*?)\];/.exec(vite)?.[1] ?? '';
      expect(external, dir).toMatch(/'react'/);
      expect(external, dir).toMatch(/'@c4s\/plugin-runtime\/ui'/);
    }

    // Nowhere a parallel header: the only implementation is the catalog's.
    const definers = [...sourcesUnder(join(REPO, 'src')), ...pluginSources()]
      .filter((f) => /\b(?:function|class|const|let)\s+EntityListHeader\b/.test(code(readFileSync(f, 'utf8')).replace(/declare const EntityListHeader\b/g, '')))
      .map((f) => relative(REPO, f));
    expect(definers).toEqual(['src/client/host-ui-kit/core/EntityListHeader.tsx']);
  });
});

describe('M19 list-page pattern (2.1.28)', () => {
  it('[section:thm8a14c] the full native list is composed only from /ui: EntityListLayout → EntityListHeader with search in its header → TagFilterBar in `filters` → EntityListRow per row; LoadingState while loading, EmptyState when there are no rows; the count prop covers "N results"', () => {
    const tags: Published.Tag[] = [{ slug: 'm19', name: 'M19', color: '#336699' }];
    const tagLookup = new Map(tags.map((t) => [t.slug, t]));
    function ListPage({ rows, loading }: { rows: string[]; loading: boolean }) {
      const [search, setSearch] = useState('');
      const header = createElement(ui.EntityListHeader, {
        icon: List,
        title: 'Endpoints',
        count: rows.length,
        search,
        onSearchChange: setSearch,
        filters: createElement(ui.TagFilterBar, {
          tags,
          tagFilter: [],
          onTagToggle: () => {},
          tagMode: 'and',
          onToggleMode: () => {},
          onClear: () => {},
        }),
      });
      const body = loading
        ? createElement(ui.LoadingState, { lines: 3 })
        : rows.length === 0
          ? createElement(ui.EmptyState, { title: 'No endpoints.' })
          : rows.map((r) => createElement(ui.EntityListRow, { key: r, tags: ['m19'], tagLookup, children: r }));
      return createElement(ui.EntityListLayout, { header, children: body });
    }

    mount(createElement(ListPage, { rows: ['GET /a', 'GET /b'], loading: false }));
    expect(host.textContent).toContain('Endpoints');
    expect(host.textContent).toContain('2 results');
    expect(host.querySelector('input')).not.toBeNull();
    expect(host.textContent).toContain('Filter by tag:');
    expect(host.textContent).toContain('GET /a');
    expect(host.textContent).toContain('GET /b');
    // TagFilterBar stands in the header's `filters` slot (inside the header bar, after search).
    const headerBar = host.querySelector('h2')!.parentElement!;
    expect(headerBar.textContent).toContain('Filter by tag:');

    mount(createElement(ListPage, { rows: [], loading: false }));
    expect(host.textContent).toContain('No endpoints.');
    expect(host.textContent).toContain('0 results');

    mount(createElement(ListPage, { rows: [], loading: true }));
    expect(host.textContent).not.toContain('No endpoints.');

    // No separate counter component exists — the count prop covers it.
    expect(PLUGIN_RUNTIME_UI_EXPORT_NAMES as readonly string[]).not.toContain('CountBadge');
  });

  it('[section:9v3i7vs1] create from the list: ActionButton in the header `actions` slot opens a controlled Dialog with a FormShell; submit runs the author mutation, invalidates the list and closes the window — the header stays generic (no onCreate / createLabel)', async () => {
    const mutate = vi.fn(async (_title: string) => ({ slug: 'new-endpoint' }));
    const invalidate = vi.fn();
    const openEntity = vi.fn();

    function ListWithCreate() {
      const [open, setOpen] = useState(false);
      const [title, setTitle] = useState('');
      const onClose = () => setOpen(false);
      const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const created = await mutate(title);
        invalidate(['endpoints']);
        onClose();
        openEntity('endpoint', created.slug);
      };
      return createElement(
        'div',
        null,
        createElement(ui.EntityListHeader, {
          title: 'Endpoints',
          actions: createElement(ui.ActionButton, { variant: 'primary', label: 'New endpoint', onClick: () => setOpen(true) }),
        }),
        createElement(ui.Dialog, {
          open,
          onClose,
          title: 'New endpoint',
          children: createElement(ui.FormShell, {
            onSubmit,
            actions: createElement(ui.ActionButton, { type: 'submit', label: 'Create' }),
            children: createElement(ui.FormField, {
              label: 'Title',
              children: createElement('input', {
                'data-testid': 'title',
                value: title,
                onChange: (e: { target: { value: string } }) => setTitle(e.target.value),
              }),
            }),
          }),
        }),
      );
    }

    mount(createElement(ListWithCreate));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const newButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'New endpoint')!;
    act(() => newButton.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    const input = host.querySelector('[data-testid="title"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'Users');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    // Let the author's async submit handler (mutation → invalidate → close) settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mutate).toHaveBeenCalledWith('Users');
    expect(invalidate).toHaveBeenCalledWith(['endpoints']);
    expect(openEntity).toHaveBeenCalledWith('endpoint', 'new-endpoint');
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    // The `actions` slot is generic: the stable header carries no create flow.
    type Keys = keyof Published.EntityListHeaderProps;
    const generic: [Extract<Keys, 'onCreate' | 'createLabel'>] extends [never] ? true : false = true;
    expect(generic).toBe(true);
    // Inline tag-create and feedback come from the catalog too; the shell facades reach plugins as well.
    expect(typeof ui.Popover).toBe('function');
    expect(typeof ui.useToast).toBe('function');
    expect(PLUGIN_RUNTIME_EXPORT_NAMES).toEqual(expect.arrayContaining(['openPopover', 'toast', 'editorBridge']));
  });

  it('[section:m19l12sc] M19 contributes the stable EntityListHeader (its props in hostApiVersion) and every component it consumes is a /ui export', () => {
    expect(UI_KIT_STABLE_COMPONENTS as readonly string[]).toContain('EntityListHeader');
    expect(VERSIONED_UI_KIT_COMPONENTS as readonly string[]).toContain('EntityListHeader');
    const consumed = [
      'EntityListLayout',
      'Pagination',
      'EmptyState',
      'TagFilterBar',
      'EntityListRow',
      'Badge',
      'LoadingState',
      'ActionButton',
      'Dialog',
      'FormShell',
      'Popover',
      'useToast',
      'EnumBadgePicker',
      'GroupedRelationPicker',
    ];
    for (const name of consumed) {
      expect(PLUGIN_RUNTIME_UI_EXPORT_NAMES as readonly string[], name).toContain(name);
      expect(ui, name).toHaveProperty(name);
    }
    // Consumption does not version anything: the consumed components stay experimental.
    for (const name of consumed) expect(UI_KIT_STABLE_COMPONENTS as readonly string[], name).not.toContain(name);
  });
});
