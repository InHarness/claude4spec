import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_KIT_CATALOG, UI_KIT_STABLE_COMPONENTS as BROWSER_STABLE } from './registry.js';
import { UI_KIT_STABLE_COMPONENTS } from '../../shared/plugin-host/ui-kit-surface.js';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
import { VERSIONED_UI_KIT_COMPONENTS } from '../../shared/plugin-host/host-api.js';
import { PLUGIN_RUNTIME_UI_EXPORT_NAMES } from '../../shared/plugin-host/frontend-manifest.js';
import { pluginRuntimeLegOf } from '../../shared/plugin-host/runtime-legs.js';
// The backend half of `@c4s/plugin-runtime/ui` (what a plugin backend links against).
import * as uiBackendLeg from '../../server/plugin-runtime/ui.js';
// The browser half of `@c4s/plugin-runtime/ui` (the catalog's re-export surface).
import * as uiBrowserSurface from './index.js';

describe('Host UI Kit catalog registry (M34/L12)', () => {
  it('catalogs all 32 components across the eight groups', () => {
    expect(UI_KIT_CATALOG).toHaveLength(32);
    const byGroup = (g: string) => UI_KIT_CATALOG.filter((c) => c.group === g).map((c) => c.name);
    expect(byGroup('core')).toEqual(['EntityListHeader', 'DetailPanelShell', 'FieldRow', 'FieldGrid']);
    expect(byGroup('list')).toEqual([
      'EntityListLayout',
      'Pagination',
      'EmptyState',
      'TagFilterBar',
      'EntityListRow',
      'GroupedEntityList',
    ]);
    expect(byGroup('actions')).toEqual(['ActionButton', 'ActionBar', 'Badge', 'LoadingState']);
    expect(byGroup('form')).toEqual(['FormField', 'InlineEditField']);
    expect(byGroup('overlay')).toEqual(['Dialog', 'FormShell']);
    expect(byGroup('detail')).toEqual([
      'SegmentedControlTabs',
      'VersionHistory',
      'DiffView',
      'EntityDetailToolbar',
      'RichTextField',
      'TagPicker',
      'ReferencesList',
      'DocumentBody',
      'DocEditor',
      'EntityVersionHistoryView',
    ]);
    expect(byGroup('feedback')).toEqual(['Popover', 'ToastViewport']);
    expect(byGroup('pickers')).toEqual(['EnumBadgePicker', 'GroupedRelationPicker']);
  });

  it('marks exactly the four Core components stable and the rest experimental', () => {
    const stable = UI_KIT_CATALOG.filter((c) => c.stability === 'stable').map((c) => c.name);
    const experimental = UI_KIT_CATALOG.filter((c) => c.stability === 'experimental');
    expect(stable).toEqual(['EntityListHeader', 'DetailPanelShell', 'FieldRow', 'FieldGrid']);
    expect(experimental).toHaveLength(28);
    // Every Core component is stable; no other group is.
    for (const c of UI_KIT_CATALOG) {
      expect(c.stability).toBe(c.group === 'core' ? 'stable' : 'experimental');
    }
  });

  it('[ac:ac-kazdy-wpis-katalogu-host-ui-kit-deklaruj] every catalog entry declares a binding', () => {
    for (const c of UI_KIT_CATALOG) {
      expect(['presentational', 'connected']).toContain(c.binding);
    }
  });

  it('marks exactly DocEditor and EntityVersionHistoryView as connected', () => {
    const connected = UI_KIT_CATALOG.filter((c) => c.binding === 'connected').map((c) => c.name);
    expect(connected).toEqual(['DocEditor', 'EntityVersionHistoryView']);
  });

  it('[ac:ac-komponent-o-binding-connected-jawni] every connected entry names the L11 surface it consumes, and no presentational one does', () => {
    for (const c of UI_KIT_CATALOG) {
      if (c.binding === 'connected') {
        expect(c.l11Surfaces?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(c.l11Surfaces).toBeUndefined();
      }
    }
  });

  it('keeps the whole stable core presentational', () => {
    for (const c of UI_KIT_CATALOG.filter((c) => c.stability === 'stable')) {
      expect(c.binding).toBe('presentational');
    }
  });

  it('[ac:ac-entityversionhistoryview-ma-stability] keeps the new connected block experimental, outside the versioned surface', () => {
    const block = UI_KIT_CATALOG.find((c) => c.name === 'EntityVersionHistoryView');
    expect(block?.stability).toBe('experimental');
    // Adding it to the catalog must NOT pull it into `hostApiVersion`.
    expect(BROWSER_STABLE).not.toContain('EntityVersionHistoryView');
    expect(HOST_API_VERSION).toBe('2.1.0');
  });

  it('[section:m34l12sc] the browser /ui leg derives UI_KIT_STABLE_COMPONENTS from the registry, equal to the backend /ui leg constant of the same name', () => {
    // Derived from the registry: exactly the `stable` entries, in catalog order.
    expect(BROWSER_STABLE).toEqual(
      UI_KIT_CATALOG.filter((c) => c.stability === 'stable').map((c) => c.name),
    );
    // The browser `/ui` surface exports that same derived list, under the one
    // name both legs share (2.1.25, m33rt001); the old browser name is gone.
    expect(uiBrowserSurface.UI_KIT_STABLE_COMPONENTS).toBe(BROWSER_STABLE);
    expect(uiBrowserSurface).not.toHaveProperty('STABLE_UI_KIT_COMPONENTS');
    // Equal to the constant the backend `/ui` leg carries — same names, no
    // duplicates, nothing on one side missing from the other.
    const backend = [...uiBackendLeg.UI_KIT_STABLE_COMPONENTS];
    expect(new Set(backend).size).toBe(backend.length);
    expect(new Set(BROWSER_STABLE).size).toBe(BROWSER_STABLE.length);
    expect([...BROWSER_STABLE].sort()).toEqual(backend.sort());
    // The backend leg serves the shared versioned list itself, not a copy.
    expect(uiBackendLeg.UI_KIT_STABLE_COMPONENTS).toBe(UI_KIT_STABLE_COMPONENTS);
  });
  it('[section:m34l12sc] /ui exports UI_KIT_CATALOG as data plus useToast, useHostTokens, HOST_TOKEN_NAMES and readHostTokens beside it, none of them a catalog entry', () => {
    expect(uiBrowserSurface.UI_KIT_CATALOG).toBe(UI_KIT_CATALOG);
    for (const e of UI_KIT_CATALOG) {
      expect(Object.keys(e).filter((k) => k !== 'l11Surfaces').sort()).toEqual(
        ['binding', 'group', 'name', 'stability'].sort(),
      );
    }
    const names = UI_KIT_CATALOG.map((c) => c.name);
    for (const beside of ['useToast', 'useHostTokens', 'HOST_TOKEN_NAMES', 'readHostTokens']) {
      expect(uiBrowserSurface).toHaveProperty(beside);
      expect(names).not.toContain(beside);
    }
  });

  it('[ac:ac-doceditor-m34-experimental-host-wired] the connected DocEditor entry names the L11 singletons editorBridge and queryClient as its consumed surface', () => {
    const docEditor = UI_KIT_CATALOG.find((c) => c.name === 'DocEditor');
    expect(docEditor?.binding).toBe('connected');
    expect(docEditor?.stability).toBe('experimental');
    expect(docEditor?.l11Surfaces).toEqual(['editorBridge', 'queryClient']);
    // Both names are singletons the published `@c4s/plugin-runtime` surface
    // (L11) actually exports, not labels of their own.
    const published = readFileSync(
      fileURLToPath(new URL('../../plugin-types/plugin-runtime.ts', import.meta.url)),
      'utf8',
    );
    for (const singleton of docEditor?.l11Surfaces ?? []) {
      expect(published).toMatch(new RegExp(`export declare const ${singleton}: `));
    }
  });

  it('[section:m33rt001] the data services feed the L12 catalog (TagFilterBar among it, re-exported on /ui), DiffView takes its hunks from a caller, and the connected DocEditor binds the editorBridge and queryClient singletons', () => {
    const byName = (n: string) => UI_KIT_CATALOG.find((c) => c.name === n);
    // L12 consumers of the data services: presentational, props-in — TagFilterBar
    // is one of them and travels on the browser leg of `@c4s/plugin-runtime/ui`.
    for (const name of ['VersionHistory', 'TagPicker', 'TagFilterBar', 'ReferencesList']) {
      expect(byName(name)?.binding, name).toBe('presentational');
      expect(byName(name)?.l11Surfaces, name).toBeUndefined();
      expect(PLUGIN_RUNTIME_UI_EXPORT_NAMES, name).toContain(name);
      expect(uiBrowserSurface, name).toHaveProperty(name);
    }
    expect(byName('TagFilterBar')?.group).toBe('list');
    // DiffView's hunks do not come from a data service: the component is
    // presentational and consumes no L11 surface; `lineDiffHunks` (a pure util,
    // browser leg) is one of the sources a caller hands it.
    expect(byName('DiffView')?.binding).toBe('presentational');
    expect(byName('DiffView')?.l11Surfaces).toBeUndefined();
    expect(pluginRuntimeLegOf('lineDiffHunks')).toBe('browser');
    // The connected components power themselves: EntityVersionHistoryView calls
    // the hooks, DocEditor binds the editorBridge and queryClient singletons —
    // every name a browser-leg value of `@c4s/plugin-runtime`.
    const connected = UI_KIT_CATALOG.filter((c) => c.binding === 'connected').map((c) => c.name);
    expect(connected).toEqual(expect.arrayContaining(['DocEditor', 'EntityVersionHistoryView']));
    expect(byName('DocEditor')?.l11Surfaces).toEqual(['editorBridge', 'queryClient']);
    for (const c of UI_KIT_CATALOG.filter((e) => e.binding === 'connected')) {
      expect(c.l11Surfaces?.length ?? 0, c.name).toBeGreaterThan(0);
      for (const surface of c.l11Surfaces ?? []) expect(pluginRuntimeLegOf(surface), `${c.name} → ${surface}`).toBe('browser');
    }
  });
});

/**
 * 2.1.28 (M34 `m34l12sc`) — the `ui-kit-component` records at 2.1.28, registry
 * fields only: `[name, group, stability, binding, dataSources with usage
 * fetchedByComponent]`. `feedsProps` sources are a caller's business and stay
 * out of the entry; a pure util (e.g. `lineDiffHunks`) fetches nothing and is
 * not a data source.
 */
const RECORDS: ReadonlyArray<readonly [string, string, 'stable' | 'experimental', 'presentational' | 'connected', readonly string[]]> = [
  ['ActionBar', 'actions', 'experimental', 'presentational', []],
  ['ActionButton', 'actions', 'experimental', 'presentational', []],
  ['Badge', 'actions', 'experimental', 'presentational', []],
  ['DetailPanelShell', 'core', 'stable', 'presentational', []],
  ['Dialog', 'overlay', 'experimental', 'presentational', []],
  ['DiffView', 'detail', 'experimental', 'presentational', []],
  ['DocEditor', 'detail', 'experimental', 'connected', ['editorBridge', 'queryClient']],
  ['DocumentBody', 'detail', 'experimental', 'presentational', []],
  ['EmptyState', 'list', 'experimental', 'presentational', []],
  ['EntityDetailToolbar', 'detail', 'experimental', 'presentational', []],
  ['EntityListHeader', 'core', 'stable', 'presentational', []],
  ['EntityListLayout', 'list', 'experimental', 'presentational', []],
  ['EntityListRow', 'list', 'experimental', 'presentational', []],
  [
    'EntityVersionHistoryView',
    'detail',
    'experimental',
    'connected',
    ['useVersions', 'useVersionDetail', 'useRestoreVersion', 'useReleases'],
  ],
  ['EnumBadgePicker', 'pickers', 'experimental', 'presentational', []],
  ['FieldGrid', 'core', 'stable', 'presentational', []],
  ['FieldRow', 'core', 'stable', 'presentational', []],
  ['FormField', 'form', 'experimental', 'presentational', []],
  ['FormShell', 'overlay', 'experimental', 'presentational', []],
  ['GroupedEntityList', 'list', 'experimental', 'presentational', []],
  ['GroupedRelationPicker', 'pickers', 'experimental', 'presentational', []],
  ['InlineEditField', 'form', 'experimental', 'presentational', []],
  ['LoadingState', 'actions', 'experimental', 'presentational', []],
  ['Pagination', 'list', 'experimental', 'presentational', []],
  ['Popover', 'feedback', 'experimental', 'presentational', []],
  ['ReferencesList', 'detail', 'experimental', 'presentational', []],
  ['RichTextField', 'detail', 'experimental', 'presentational', []],
  ['SegmentedControlTabs', 'detail', 'experimental', 'presentational', []],
  ['TagFilterBar', 'list', 'experimental', 'presentational', []],
  ['TagPicker', 'detail', 'experimental', 'presentational', []],
  ['ToastViewport', 'feedback', 'experimental', 'presentational', []],
  ['VersionHistory', 'detail', 'experimental', 'presentational', []],
];

/** Every non-test TS/TSX source under `dir`. */
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

describe('Host UI Kit registry ↔ ui-kit-component records (M34/L12, 2.1.28)', () => {
  it('[section:m34l12sc] the registry mirrors the ui-kit-component records: one entry per record with its name, group, stability, binding and, for connected ones, l11Surfaces = the dataSources fetched by the component', () => {
    const byName = new Map(UI_KIT_CATALOG.map((e) => [e.name, e]));
    expect([...byName.keys()].sort()).toEqual(RECORDS.map(([name]) => name).sort());
    for (const [name, group, stability, binding, fetched] of RECORDS) {
      const e = byName.get(name);
      expect(e?.group, name).toBe(group);
      expect(e?.stability, name).toBe(stability);
      expect(e?.binding, name).toBe(binding);
      if (fetched.length > 0) expect(e?.l11Surfaces, name).toEqual(fetched);
      else expect(e?.l11Surfaces, name).toBeUndefined();
    }
    // The pure util the history block calls is not one of its data sources.
    expect(byName.get('EntityVersionHistoryView')?.l11Surfaces).not.toContain('lineDiffHunks');
    // The stable list both /ui legs carry is the stable records, derived from the registry.
    const stableRecords = RECORDS.filter(([, , s]) => s === 'stable').map(([name]) => name);
    expect([...BROWSER_STABLE].sort()).toEqual([...stableRecords].sort());
    expect([...uiBackendLeg.UI_KIT_STABLE_COMPONENTS].sort()).toEqual([...stableRecords].sort());
  });

  it('[ac:ac-autor-bierze-tier-experimental-za-bra] the tier speaks only of hostApiVersion: every experimental entry ships on /ui like a stable one, and no plugin in this repo vendors a catalog component', () => {
    const experimental = UI_KIT_CATALOG.filter((c) => c.stability === 'experimental');
    expect(experimental.length).toBeGreaterThan(0);
    // No consumption gate: an experimental component is exported by the same
    // `/ui` subpath (browser leg and published export list) as a stable one…
    for (const c of UI_KIT_CATALOG) {
      expect(uiBrowserSurface, c.name).toHaveProperty(c.name);
      expect(PLUGIN_RUNTIME_UI_EXPORT_NAMES, c.name).toContain(c.name);
    }
    // …and the tier decides only membership of the versioned list.
    for (const c of experimental) {
      expect(BROWSER_STABLE, c.name).not.toContain(c.name);
      expect(uiBackendLeg.UI_KIT_STABLE_COMPONENTS as readonly string[], c.name).not.toContain(c.name);
    }
    // So there is no reason to vendor one: no plugin source defines a
    // component under a catalog entry's name (a copy would miss the original's fixes).
    const pluginsDir = fileURLToPath(new URL('../../../plugins/', import.meta.url));
    const names = UI_KIT_CATALOG.map((c) => c.name).join('|');
    const definition = new RegExp(`\\b(?:function|const|class)\\s+(${names})\\b`);
    const files = readdirSync(pluginsDir)
      .map((pkg) => join(pluginsDir, pkg, 'src'))
      .filter((src) => {
        try {
          return statSync(src).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap((src) => sourcesUnder(src));
    expect(files.length).toBeGreaterThan(0);
    const vendored = files.filter((f) => definition.test(readFileSync(f, 'utf8')));
    expect(vendored).toEqual([]);
  });
});

/**
 * 2.1.28 (unit kit-primitives) — one `[entity:<slug>]` check per
 * `ui-kit-component` record of the catalog primitives, list, actions, form,
 * overlay and feedback components: the registry entry carries the record's
 * `group`, `stability`, `binding` and L11 surfaces (`dataSources` with usage
 * `fetchedByComponent` — `feedsProps` sources such as `useTags` are a caller's
 * business and stay out of the entry), and the record's `composes` holds in code:
 * the component's module imports and renders each composed catalog component.
 * The registry entry shape is `{ name; group; stability; binding; l11Surfaces? }`
 * (m34l12sc), so `composes` is read off the implementation, not the entry.
 */
interface PrimitiveRecord {
  name: string;
  group: string;
  stability: 'stable' | 'experimental';
  binding: 'presentational' | 'connected';
  fetchedByComponent: readonly string[];
  /** `[catalog name, module path relative to host-ui-kit/]` per `composes` entry. */
  composes: ReadonlyArray<readonly [string, string]>;
  /** The component's module, relative to `host-ui-kit/`. */
  file: string;
}

const PRIMITIVE_RECORDS: Record<string, PrimitiveRecord> = {
  'action-bar': { name: 'ActionBar', group: 'actions', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['ActionButton', './ActionButton.js']], file: 'actions/ActionBar.tsx' },
  'action-button': { name: 'ActionButton', group: 'actions', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'actions/ActionButton.tsx' },
  badge: { name: 'Badge', group: 'actions', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'actions/Badge.tsx' },
  dialog: { name: 'Dialog', group: 'overlay', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'overlay/Dialog.tsx' },
  'empty-state': { name: 'EmptyState', group: 'list', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'list/EmptyState.tsx' },
  'entity-list-layout': { name: 'EntityListLayout', group: 'list', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'list/EntityListLayout.tsx' },
  'entity-list-row': { name: 'EntityListRow', group: 'list', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['Badge', '../actions/Badge.js']], file: 'list/EntityListRow.tsx' },
  'form-field': { name: 'FormField', group: 'form', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'form/FormField.tsx' },
  'form-shell': { name: 'FormShell', group: 'overlay', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'overlay/FormShell.tsx' },
  'grouped-entity-list': { name: 'GroupedEntityList', group: 'list', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'list/GroupedEntityList.tsx' },
  'inline-edit-field': { name: 'InlineEditField', group: 'form', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'form/InlineEditField.tsx' },
  'loading-state': { name: 'LoadingState', group: 'actions', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'actions/LoadingState.tsx' },
  pagination: { name: 'Pagination', group: 'list', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'list/Pagination.tsx' },
  popover: { name: 'Popover', group: 'feedback', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'overlay-feedback/Popover.tsx' },
  'tag-filter-bar': { name: 'TagFilterBar', group: 'list', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['Badge', '../actions/Badge.js']], file: 'list/TagFilterBar.tsx' },
  'toast-viewport': { name: 'ToastViewport', group: 'feedback', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'overlay-feedback/ToastViewport.tsx' },
};

/** Every catalog component name, for the "composes nothing else" half. */
const CATALOG_NAMES = UI_KIT_CATALOG.map((c) => c.name);

function expectEntryMatchesRecord(slug: string) {
  const rec = (PRIMITIVE_RECORDS[slug] ?? M13_SCAFFOLD_RECORDS[slug] ?? KIT_DETAIL_HISTORY_RECORDS[slug])!;
  const e = UI_KIT_CATALOG.find((c) => c.name === rec.name);
  expect(e, slug).toBeDefined();
  expect(e?.group, slug).toBe(rec.group);
  expect(e?.stability, slug).toBe(rec.stability);
  expect(e?.binding, slug).toBe(rec.binding);
  if (rec.fetchedByComponent.length > 0) expect(e?.l11Surfaces, slug).toEqual(rec.fetchedByComponent);
  else expect(e?.l11Surfaces, slug).toBeUndefined();
  // Experimental records stay off the versioned stable list (both /ui legs).
  expect(BROWSER_STABLE.includes(rec.name), slug).toBe(rec.stability === 'stable');
  expect((UI_KIT_STABLE_COMPONENTS as readonly string[]).includes(rec.name), slug).toBe(rec.stability === 'stable');

  // `composes`: the module imports each composed catalog component and renders it as JSX…
  const source = readFileSync(fileURLToPath(new URL(`./${rec.file}`, import.meta.url)), 'utf8');
  for (const [composed, from] of rec.composes) {
    expect(source, `${slug} imports ${composed}`).toMatch(
      new RegExp(`import \\{[^}]*\\b${composed}\\b[^}]*\\} from '${from.replace(/[.]/g, '\\.')}'`),
    );
    expect(source, `${slug} renders <${composed}>`).toMatch(new RegExp(`<${composed}\\b`));
  }
  // …and no other catalog component than the ones the record names.
  const imported = [...source.matchAll(/import \{([^}]*)\} from '\.\.?\/[^']*'/g)]
    .flatMap((m) => m[1]!.split(',').map((s) => s.trim().replace(/^type\s+/, '')))
    .filter((n) => CATALOG_NAMES.includes(n) && n !== rec.name);
  expect([...new Set(imported)].sort(), `${slug} composes`).toEqual(rec.composes.map(([n]) => n).sort());
}

describe('Host UI Kit registry ↔ catalog primitives records (M34/L12, 2.1.28)', () => {
  it('[entity:action-bar] registry entry matches the record (actions, experimental, presentational, no L11 surface) and composes ActionButton', () => expectEntryMatchesRecord('action-bar'));
  it('[entity:action-button] registry entry matches the record (actions, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('action-button'));
  it('[entity:badge] registry entry matches the record (actions, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('badge'));
  it('[entity:dialog] registry entry matches the record (overlay, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('dialog'));
  it('[entity:empty-state] registry entry matches the record (list, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('empty-state'));
  it('[entity:entity-list-layout] registry entry matches the record (list, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('entity-list-layout'));
  it('[entity:entity-list-row] registry entry matches the record (list, experimental, presentational; useTags only feeds props, so no L11 surface) and composes Badge', () => expectEntryMatchesRecord('entity-list-row'));
  it('[entity:form-field] registry entry matches the record (form, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('form-field'));
  it('[entity:form-shell] registry entry matches the record (overlay, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('form-shell'));
  it('[entity:grouped-entity-list] registry entry matches the record (list, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('grouped-entity-list'));
  it('[entity:inline-edit-field] registry entry matches the record (form, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('inline-edit-field'));
  it('[entity:loading-state] registry entry matches the record (actions, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('loading-state'));
  it('[entity:pagination] registry entry matches the record (list, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('pagination'));
  it('[entity:popover] registry entry matches the record (feedback, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('popover'));
  it('[entity:tag-filter-bar] registry entry matches the record (list, experimental, presentational; useTags only feeds props, so no L11 surface) and composes Badge', () => expectEntryMatchesRecord('tag-filter-bar'));
  it('[entity:toast-viewport] registry entry matches the record (feedback, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('toast-viewport'));
});

/**
 * 2.1.28 (unit m13-detail-scaffold) — the detail scaffold M13 contributes to
 * the catalog (m13l12sc): `DetailPanelShell`, `FieldGrid`, `FieldRow` (core,
 * stable — their `props` count into hostApiVersion) and `DocumentBody`
 * (detail, experimental). All presentational, no data sources, composing no
 * other catalog component.
 */
const M13_SCAFFOLD_RECORDS: Record<string, PrimitiveRecord> = {
  'detail-panel-shell': { name: 'DetailPanelShell', group: 'core', stability: 'stable', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'core/DetailPanelShell.tsx' },
  'document-body': { name: 'DocumentBody', group: 'detail', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'detail/DocumentBody.tsx' },
  'field-grid': { name: 'FieldGrid', group: 'core', stability: 'stable', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'core/FieldGrid.tsx' },
  'field-row': { name: 'FieldRow', group: 'core', stability: 'stable', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'core/FieldRow.tsx' },
};

describe('Host UI Kit registry ↔ M13 detail scaffold records (M13/M34, L12, 2.1.28)', () => {
  it('[entity:detail-panel-shell] registry entry matches the record (core, stable — on the versioned stable list —, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('detail-panel-shell'));
  it('[entity:document-body] registry entry matches the record (detail, experimental — off the stable list —, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('document-body'));
  it('[entity:field-grid] registry entry matches the record (core, stable — on the versioned stable list —, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('field-grid'));
  it('[section:m13l12sc] M13 contributes the detail scaffold to /ui: shell, field row and two body layouts; only the stable props count into hostApiVersion, and DocumentBody carries the token-bridge typography', () => {
    for (const rec of Object.values(M13_SCAFFOLD_RECORDS)) {
      expect(uiBrowserSurface, rec.name).toHaveProperty(rec.name);
      expect(PLUGIN_RUNTIME_UI_EXPORT_NAMES, rec.name).toContain(rec.name);
    }
    // Version surface: the stable records' props are versioned, the experimental one is not.
    expect(VERSIONED_UI_KIT_COMPONENTS).toEqual(expect.arrayContaining(['DetailPanelShell', 'FieldGrid', 'FieldRow']));
    expect(VERSIONED_UI_KIT_COMPONENTS as readonly string[]).not.toContain('DocumentBody');
    // Token bridge: M13 reaches the typography class through DocumentBody.
    const docBody = readFileSync(fileURLToPath(new URL('./detail/DocumentBody.tsx', import.meta.url)), 'utf8');
    for (const v of ['--font-heading', '--text-h1', '--weight-heading', '--font-body', '--text-body', '--text-lede', '--weight-lede']) {
      expect(docBody, v).toContain(`var(${v})`);
    }
  });
  it('[entity:field-row] registry entry matches the record (core, stable — on the versioned stable list —, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('field-row'));
});

/**
 * 2.1.28 (unit kit-detail-history) — the detail-panel, history and picker
 * records. `l11Surfaces` = the record's `dataSources` with usage
 * `fetchedByComponent` (the two connected blocks); `feedsProps` sources
 * (`lineDiffHunks`, `useReferences`, `useTags`/`tagsService`, `useVersions`/
 * `useReleases` on VersionHistory) are a caller's business and stay out.
 */
const KIT_DETAIL_HISTORY_RECORDS: Record<string, PrimitiveRecord> = {
  'diff-view': { name: 'DiffView', group: 'detail', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['EmptyState', '../list/EmptyState.js']], file: 'detail/DiffView.tsx' },
  'doc-editor': { name: 'DocEditor', group: 'detail', stability: 'experimental', binding: 'connected', fetchedByComponent: ['editorBridge', 'queryClient'], composes: [], file: 'detail/DocEditor.tsx' },
  'entity-detail-toolbar': { name: 'EntityDetailToolbar', group: 'detail', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['ActionButton', '../actions/ActionButton.js']], file: 'detail/EntityDetailToolbar.tsx' },
  'entity-version-history-view': {
    name: 'EntityVersionHistoryView',
    group: 'detail',
    stability: 'experimental',
    binding: 'connected',
    fetchedByComponent: ['useVersions', 'useVersionDetail', 'useRestoreVersion', 'useReleases'],
    composes: [
      ['LoadingState', '../actions/LoadingState.js'],
      ['EmptyState', '../list/EmptyState.js'],
      ['EntityDetailToolbar', './EntityDetailToolbar.js'],
      ['VersionHistory', './VersionHistory.js'],
      ['SegmentedControlTabs', './SegmentedControlTabs.js'],
      ['DiffView', './DiffView.js'],
    ],
    file: 'detail/EntityVersionHistoryView.tsx',
  },
  'enum-badge-picker': { name: 'EnumBadgePicker', group: 'pickers', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['Popover', '../overlay-feedback/Popover.js']], file: 'pickers/EnumBadgePicker.tsx' },
  'grouped-relation-picker': { name: 'GroupedRelationPicker', group: 'pickers', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['Popover', '../overlay-feedback/Popover.js']], file: 'pickers/GroupedRelationPicker.tsx' },
  'references-list': { name: 'ReferencesList', group: 'detail', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['LoadingState', '../actions/LoadingState.js'], ['EmptyState', '../list/EmptyState.js']], file: 'detail/ReferencesList.tsx' },
  'rich-text-field': { name: 'RichTextField', group: 'detail', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'detail/RichTextField.tsx' },
  'segmented-control-tabs': { name: 'SegmentedControlTabs', group: 'detail', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [], file: 'detail/SegmentedControlTabs.tsx' },
  'tag-picker': { name: 'TagPicker', group: 'detail', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['Badge', '../actions/Badge.js'], ['Popover', '../overlay-feedback/Popover.js']], file: 'detail/TagPicker.tsx' },
  'version-history': { name: 'VersionHistory', group: 'detail', stability: 'experimental', binding: 'presentational', fetchedByComponent: [], composes: [['EmptyState', '../list/EmptyState.js']], file: 'detail/VersionHistory.tsx' },
};

describe('Host UI Kit registry ↔ detail, history and picker records (M34/L12, 2.1.28)', () => {
  it('[entity:diff-view] registry entry matches the record (detail, experimental, presentational; lineDiffHunks only feeds props, so no L11 surface) and composes EmptyState', () => expectEntryMatchesRecord('diff-view'));
  it('[entity:doc-editor] registry entry matches the record (detail, experimental, connected, L11 editorBridge + queryClient), composes nothing', () => expectEntryMatchesRecord('doc-editor'));
  it('[entity:entity-detail-toolbar] registry entry matches the record (detail, experimental, presentational, no L11 surface) and composes ActionButton — no Dialog of its own', () => expectEntryMatchesRecord('entity-detail-toolbar'));
  it('[entity:entity-version-history-view] registry entry matches the record (detail, experimental, connected, L11 useVersions/useVersionDetail/useRestoreVersion/useReleases) and composes LoadingState, EmptyState, EntityDetailToolbar, VersionHistory, SegmentedControlTabs, DiffView', () => expectEntryMatchesRecord('entity-version-history-view'));
  it('[entity:enum-badge-picker] registry entry matches the record (pickers, experimental, presentational, no L11 surface) and composes Popover', () => expectEntryMatchesRecord('enum-badge-picker'));
  it('[entity:grouped-relation-picker] registry entry matches the record (pickers, experimental, presentational, no L11 surface) and composes Popover', () => expectEntryMatchesRecord('grouped-relation-picker'));
  it('[entity:references-list] registry entry matches the record (detail, experimental, presentational; useReferences only feeds props) and composes LoadingState and EmptyState', () => expectEntryMatchesRecord('references-list'));
  it('[entity:rich-text-field] registry entry matches the record (detail, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('rich-text-field'));
  it('[entity:segmented-control-tabs] registry entry matches the record (detail, experimental, presentational, no L11 surface), composes nothing', () => expectEntryMatchesRecord('segmented-control-tabs'));
  it('[entity:tag-picker] registry entry matches the record (detail, experimental, presentational; useTags/tagsService only feed props) and composes Badge and Popover', () => expectEntryMatchesRecord('tag-picker'));
  it('[entity:version-history] registry entry matches the record (detail, experimental, presentational; useVersions/useReleases only feed props) and composes EmptyState', () => expectEntryMatchesRecord('version-history'));

  it('[section:m13l11sc] the history components render no useVersionDiff delta: none of them reaches useVersionDiff or EntityDiff — only the M17 release-diff formatter renders it', () => {
    for (const slug of ['version-history', 'diff-view', 'entity-version-history-view']) {
      const rec = KIT_DETAIL_HISTORY_RECORDS[slug]!;
      const source = readFileSync(fileURLToPath(new URL(`./${rec.file}`, import.meta.url)), 'utf8');
      // Code only — the doc comments may name the hook to say it is not used.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, slug).not.toMatch(/\buseVersionDiff\b/);
      expect(code, slug).not.toMatch(/\bEntityDiff\b/);
    }
  });
});
