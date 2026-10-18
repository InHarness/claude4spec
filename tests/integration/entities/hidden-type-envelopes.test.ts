// @vitest-environment happy-dom
/**
 * 2.1.20 — the L11 envelopes and L12 fullscreen forms of the HIDDEN types
 * (`diagram`, `code-snippet`, `spreadsheet`, and the host contract the
 * `spec-operation` presentation table relies on).
 *
 * What the pages now say, per type:
 *   - the type's frontend is NOT in its contribution: a separate module of shape
 *     `FrontendModule` fills `renderChip`, `renderCard`, `renderOverlay` (required —
 *     the type is hidden) and the two required hooks, and supplies no
 *     `sidebarTab`, `routes`, `detailPanel` or `renderRow`;
 *   - package types (`code-snippet`, `spreadsheet`) register it from their
 *     BROWSER entry via `registerFrontendModule`; `diagram`, built into the host
 *     bundle, enters the client registry through the host's own door;
 *   - a chip click is routed by the HOST to the `<type>-expand` window, whose
 *     content is the type's `renderOverlay` — the chip (and the card) opens
 *     nothing itself;
 *   - the fullscreen forms (`DiagramFullscreen` behind `DiagramOverlay`,
 *     `CodeSnippetFullscreen`) are that window's content; `DiagramFullscreen`
 *     resolves its record by `slug`, on open, while `CodeSnippetFullscreen` is
 *     one component with two inputs (`2i5ypc7q`): the card's ready record, or
 *     a fetch by `slug` when opened from the chip.
 *
 * ASSUMPTION:dev-2005 — `code-snippet`'s `/code-snippet` trigger stays declared
 * once, in `contributes.commands` (as dev-2004 does for the visible package
 * types), not as an `editorExtensions` entry on the module.
 *
 * Lives under `tests/` because it imports the envelopes' own sources next to
 * the host's client sources, which no single tsconfig compiles together.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registered = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const diagramHooks = vi.hoisted(() => ({
  useDiagram: [] as Array<string | null>,
  useDiagramSource: [] as Array<string | null>,
}));
const renderCalls = vi.hoisted(() => ({ count: 0 }));
const snippetFetches = vi.hoisted(() => [] as string[]);

vi.mock('@c4s/plugin-runtime', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  const { clientPluginHost } = await import('../../../src/client/core/plugin-host/host.js');
  return {
    ...original,
    clientPluginHost,
    registerFrontendModule: (mod: Record<string, unknown>) => {
      // the host's door first: a module it rejects never counts as registered
      clientPluginHost.registerFrontendModule(mod as never);
      registered.push(mod);
    },
  };
});

vi.mock('../../../plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/slash-create.js', () => ({
  mountCodeSnippetSlashCreate: () => () => undefined,
}));
vi.mock('../../../plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/frontend/slash-create.js', () => ({
  mountSpreadsheetSlashCreate: () => () => undefined,
  SPREADSHEET_POPOVER_KIND: 'spreadsheet-create',
}));

vi.mock('../../../plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/hooks.js', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  fetchCodeSnippet: async (slug: string) => {
    snippetFetches.push(slug);
    return {
      slug,
      title: 'Manifest shape',
      language: 'ts',
      filename: 'src/manifest.ts',
      code: 'export const manifest = {};',
    };
  },
}));

const DIAGRAM = { slug: 'one', title: 'One', format: 'mermaid', hasSource: true, sourceBytes: 14 };
vi.mock('../../../src/client/hooks/useDiagrams.js', () => ({
  useDiagram: (slug: string | null) => {
    diagramHooks.useDiagram.push(slug);
    return { data: slug ? { ...DIAGRAM, slug } : null, isLoading: false };
  },
  useDiagramSource: (slug: string | null) => {
    diagramHooks.useDiagramSource.push(slug);
    return { data: slug ? 'graph TD; A-->B' : undefined };
  },
  useUpdateDiagram: () => ({ mutate: () => undefined }),
}));
vi.mock('../../../src/client/state/tweaks.js', () => ({ useTheme: () => ({ effectiveTheme: 'light' }) }));
vi.mock('../../../src/client/tiptap/extensions/diagramRender.js', () => ({
  renderDiagram: async () => {
    renderCalls.count += 1;
    return { ok: true, svg: '<svg data-testid="dgm-svg"></svg>' };
  },
  hashSource: () => 'h',
  sanitizeRenderId: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_'),
  isSupportedFormat: () => true,
}));

import { clientPluginHost } from '../../../src/client/core/plugin-host/host.js';
import { checkSlotShapes, isHiddenModule } from '../../../src/client/core/plugin-host/slot-rules.js';
import type { FrontendModule } from '../../../src/client/core/plugin-host/types.js';
import { openEntityHandler } from '../../../src/client/entities/openEntity.js';
import { listPickerEntityTypes } from '../../../src/client/entities/registry.js';
import { UI_EVENTS } from '../../../src/client/ui/events.js';
import { diagramFrontendModule, diagramAuthoringExtension } from '../../../src/client/entities/diagram/plugin.js';
import { DiagramCard, DiagramOverlay } from '../../../src/client/entities/diagram/DiagramCard.js';
import { codeSnippetFrontendModule } from '../../../plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/module.js';
import { CodeSnippetFullscreen } from '../../../plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/fullscreen.js';
import { manifest as codeSnippetsManifest } from '../../../plugins/c4s-plugin-code-snippets/src/manifest.js';
import { spreadsheetFrontendModule } from '../../../plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/frontend/module.js';
import { SpreadsheetFullscreen } from '../../../plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/frontend/node-view.js';
import { manifest as spreadsheetsManifest } from '../../../plugins/c4s-plugin-spreadsheets/src/manifest.js';

// Resolved with node:path from the module's own file path — under happy-dom the
// global `URL` is the window's, so `new URL(rel, import.meta.url)` is not a
// `file:` URL that `fileURLToPath` accepts (same pattern as tokens.render.test.ts).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = (rel: string) => resolve(REPO_ROOT, rel);

/** Source with comments stripped — assertions about code, not prose. */
function codeOf(rel: string): string {
  return readFileSync(root(rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const byEntry = new Map<string, Array<Record<string, unknown>>>();

beforeAll(async () => {
  for (const [pkg, load] of [
    ['c4s-plugin-code-snippets', () => import('../../../plugins/c4s-plugin-code-snippets/src/frontend.js')],
    ['c4s-plugin-spreadsheets', () => import('../../../plugins/c4s-plugin-spreadsheets/src/frontend.js')],
  ] as const) {
    const before = registered.length;
    await load();
    byEntry.set(pkg, registered.slice(before));
  }
}, 60_000);

/** Modal requests the window bus carried while `fn` ran. */
function modalsDuring(fn: () => void): Array<{ kind: string; props: Record<string, unknown> }> {
  const seen: Array<{ kind: string; props: Record<string, unknown> }> = [];
  const listener = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener(UI_EVENTS.MODAL, listener);
  try {
    fn();
  } finally {
    window.removeEventListener(UI_EVENTS.MODAL, listener);
  }
  return seen;
}

function drawChip(mod: FrontendModule, entity: unknown, onOpen?: () => void): ReactElement<Record<string, unknown>> {
  const Chip = mod.renderChip as unknown as (p: Record<string, unknown>) => ReactElement<Record<string, unknown>>;
  return Chip({ slug: 'one', entity, ...(onOpen ? { onOpen } : {}) });
}

/**
 * The hidden-type shape, asserted on the module the registry holds: the four
 * required slots, `renderOverlay`, and none of sidebar entry / routes / detail
 * panel / list row; no retired slot.
 */
function expectHiddenModule(type: string, overlay: unknown): FrontendModule {
  const mod = clientPluginHost.getEntity(type);
  expect(mod, type).not.toBeNull();
  expect(checkSlotShapes(mod!)).toBeNull();
  for (const slot of ['renderChip', 'renderCard', 'useGetBySlug', 'listByTags'] as const) {
    expect(typeof mod![slot], `${type}.${slot}`).toBe('function');
  }
  expect(isHiddenModule(mod!)).toBe(true);
  expect(mod!.sidebarTab).toBeUndefined();
  expect(mod!.routes).toBeUndefined();
  expect(mod!.detailPanel).toBeUndefined();
  expect(mod!.renderRow).toBeUndefined();
  expect(mod!.renderOverlay).toBe(overlay);
  expect('stateSlice' in mod!).toBe(false);
  return mod!;
}

/** A click goes to the host's `<type>-expand` window; the chip opens nothing itself. */
function expectHostRoutedExpand(type: string, entity: unknown): void {
  const mod = clientPluginHost.getEntity(type)!;
  const bridge = { openEntity: vi.fn() };
  const open = openEntityHandler(type, 'one', bridge);
  expect(open).toBeTypeOf('function');
  const opened = modalsDuring(() => open!());
  expect(bridge.openEntity).not.toHaveBeenCalled();
  expect(opened).toHaveLength(1);
  expect(opened[0]!.kind).toBe(`${type}-expand`);
  expect(opened[0]!.props).toEqual({ slug: 'one' });

  const onOpen = vi.fn();
  const drawn = modalsDuring(() => {
    expect(drawChip(mod, entity, onOpen).props.onClick).toBe(onOpen);
    expect(drawChip(mod, entity).props.onClick).toBeUndefined();
  });
  expect(drawn).toHaveLength(0);
}

/** A contribution declared without any frontend half. */
function expectContributionWithoutFrontend(manifest: { contributes?: { entities?: Array<Record<string, unknown>> } }, type: string): void {
  const c = manifest.contributes?.entities?.find((e) => e.type === type);
  expect(c, `no contribution for ${type}`).toBeDefined();
  for (const key of ['frontend', 'sidebarTab', 'renderChip', 'renderCard', 'renderOverlay', 'renderRow', 'stateSlice', 'editorExtensions']) {
    expect(key in c!, `${type} contribution carries '${key}'`).toBe(false);
  }
}

/** Let pending promise callbacks (a fetch, a render) land inside `act`. */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ─── diagram ────────────────────────────────────────────────────────────────

describe('diagram — L11 envelope (frontend module through the host\'s own door)', () => {
  it('[section:dgmmanifest] the frontend module has the FrontendModule shape, carries the slots the page lists, and is what the registry holds', () => {
    expect(clientPluginHost.getAvailable('diagram')).toBe(diagramFrontendModule);
    const mod = expectHiddenModule('diagram', DiagramOverlay);
    expect(mod.renderCard).toBe(DiagramCard);
    // editorExtensions — [diagramAuthoringExtension]: `/diagram`, no node of its own.
    expect(mod.editorExtensions).toHaveLength(1);
    const ext = mod.editorExtensions![0]!;
    expect(ext.name).toBe(diagramAuthoringExtension.name);
    expect(ext.slashCommand?.id).toBe('diagram');
    expect(ext.slashCommand?.label).toBe('/diagram');
    expect((ext as { extension?: unknown }).extension).toBeUndefined();
  });

  it('[section:dgmmanifest] the frontend is NOT in the type contribution, and the built-in type does not call the plugin runtime\'s registerFrontendModule', () => {
    const contribution = codeOf('src/server/entities/diagram/plugin.ts');
    expect(contribution).not.toMatch(/^\s*frontend\s*:/m);
    expect(contribution).not.toMatch(/renderCard|renderChip|sidebarTab/);
    const client = codeOf('src/client/entities/diagram/plugin.tsx');
    expect(client).not.toMatch(/@c4s\/plugin-runtime/);
    expect(client).toMatch(/clientPluginHost\.registerFrontendModule\(diagramFrontendModule\)/);
  });

  it('[section:dgmhead0] a hidden system entity: no ELEMENTS entry, no detail route; a chip click is routed by the host to `diagram-expand`', () => {
    expectHiddenModule('diagram', DiagramOverlay);
    expectHostRoutedExpand('diagram', DIAGRAM);
  });

  it('[section:dgmenv11] hidden: renderRow not supplied, so element_list / tagged_list do not offer it; chip slot routed by the host to `diagram-expand` with renderOverlay content', () => {
    expectHiddenModule('diagram', DiagramOverlay);
    expect(listPickerEntityTypes('element')).toContain('diagram');
    expect(listPickerEntityTypes('list')).not.toContain('diagram');
    expectHostRoutedExpand('diagram', DIAGRAM);
  });

  it('[section:dgmrefnode] DiagramChip draws no diagram itself — the SVG appears only in `diagram-expand`, to which the host routes the click; the card\'s expand button is the host\'s onOpen', () => {
    const chip = renderToStaticMarkup(drawChip(diagramFrontendModule, DIAGRAM, () => {}));
    expect(chip).not.toContain('c4s-diagram-svg');
    expect(chip).not.toContain('dgm-svg');
    expect(chip).toContain('One');

    const onOpen = vi.fn();
    const withHandler = renderToStaticMarkup(createElement(DiagramCard as never, { slug: 'one', entity: DIAGRAM, onOpen }));
    const withoutHandler = renderToStaticMarkup(createElement(DiagramCard as never, { slug: 'one', entity: DIAGRAM }));
    expect(withHandler).toContain('aria-label="Expand diagram one"');
    expect(withoutHandler).not.toContain('aria-label="Expand diagram one"');
    // The card never mounts the fullscreen itself.
    expect(withHandler).not.toContain('Diagram fullscreen');
    expect(codeOf('src/client/entities/diagram/DiagramCard.tsx').match(/<DiagramFullscreen\b/g)).toHaveLength(1);
  });
});

describe('diagram — L12 (DiagramFullscreen as the `diagram-expand` content)', () => {
  it('[section:rgczgux0] DiagramFullscreen renders the `diagram-expand` content through renderOverlay — the same read-only pan+zoom shell whatever the click came from', async () => {
    const onClose = vi.fn();
    const Overlay = diagramFrontendModule.renderOverlay!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(createElement(Overlay, { slug: 'one', onClose }));
    });
    await flush();
    const dialog = document.querySelector('[role="dialog"][aria-label="Diagram fullscreen"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.style.position).toBe('fixed');
    // read-only: no edit affordance inside the window
    expect(document.querySelector('[aria-label^="Edit diagram"]')).toBeNull();
    await act(async () => r.unmount());
  });

  it('[section:dgmfull000] the window content resolves the record by slug and renders the SVG once, on open; Esc closes', async () => {
    diagramHooks.useDiagram.length = 0;
    diagramHooks.useDiagramSource.length = 0;
    renderCalls.count = 0;
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(createElement(DiagramOverlay, { slug: 'one', caption: 'Checkout', onClose }));
    });
    await flush();
    expect(diagramHooks.useDiagram).toContain('one');
    expect(diagramHooks.useDiagramSource).toContain('one');
    expect(renderCalls.count).toBe(1);
    const dialog = document.querySelector('[aria-label="Diagram fullscreen"]') as HTMLElement;
    expect(dialog.style.position).toBe('fixed');
    // On the design-system `z-modal` layer (1200) — above popovers (1100), below
    // toasts (1300) — not on the toast tier it used to share with a literal 1300.
    expect(dialog.style.zIndex).toBe('1200');
    expect(dialog.querySelector('[data-testid="dgm-svg"]')).not.toBeNull();
    expect(dialog.textContent).toContain('Checkout');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it('[ac:ac-diagram-toast-nad-otwartym-fullscreenem] a toast shown while DiagramFullscreen is open renders above the overlay', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(createElement(DiagramOverlay, { slug: 'one', onClose: () => {} }));
    });
    await flush();
    const overlayZ = Number((document.querySelector('[aria-label="Diagram fullscreen"]') as HTMLElement).style.zIndex);
    // The toast viewport sits on the bridge's `--z-toast` tier; the popover tier is below the overlay.
    const theme = readFileSync(root('src/client/styles/theme.css'), 'utf8');
    const tier = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)`).exec(theme)![1]);
    expect(readFileSync(root('src/client/host-ui-kit/overlay-feedback/ToastViewport.tsx'), 'utf8')).toContain(
      "zIndex: 'var(--z-toast)'",
    );
    expect(tier('z-toast')).toBeGreaterThan(overlayZ);
    expect(overlayZ).toBeGreaterThan(tier('z-popover'));
    await act(async () => r.unmount());
    host.remove();
  });
});

// ─── code-snippet ───────────────────────────────────────────────────────────

describe('code-snippet — L11 envelope', () => {
  it('[section:n6zlyrol] the frontend is not in the contribution; the browser entry registers the module with registerFrontendModule; renderOverlay is CodeSnippetFullscreen', () => {
    expectContributionWithoutFrontend(codeSnippetsManifest as never, 'code-snippet');
    const pkg = JSON.parse(readFileSync(root('plugins/c4s-plugin-code-snippets/package.json'), 'utf8')) as {
      exports: Record<string, { import?: string }>;
    };
    expect(pkg.exports['./frontend']?.import).toBe('./dist/frontend.js');
    const mods = byEntry.get('c4s-plugin-code-snippets') ?? [];
    expect(mods).toHaveLength(1);
    expect(mods[0]).toBe(codeSnippetFrontendModule);
    expect(clientPluginHost.getAvailable('code-snippet')).toBe(codeSnippetFrontendModule);
    expectHiddenModule('code-snippet', CodeSnippetFullscreen);
    // ASSUMPTION:dev-2005 — the `/code-snippet` trigger is declared once, on the manifest.
    const commands = (codeSnippetsManifest as { contributes?: { commands?: Array<{ trigger: string }> } }).contributes?.commands ?? [];
    expect(commands.map((c) => c.trigger)).toContain('code-snippet');
  });

  it('[section:rb4fixcw] hidden: no sidebar tab, no detail route, no renderRow; the chip click is routed by the host to `code-snippet-expand`', () => {
    expectHiddenModule('code-snippet', CodeSnippetFullscreen);
    expect(listPickerEntityTypes('list')).not.toContain('code-snippet');
    expectHostRoutedExpand('code-snippet', {
      slug: 'one',
      title: 'One',
      language: 'ts',
      code: 'export const x = 1;',
    });
  });
});

describe('code-snippet — L12 (CodeSnippetFullscreen as the `code-snippet-expand` content)', () => {
  it('[section:2i5ypc7q] opened from the chip (INLINE): the window content fetches its record by slug and shows the full code with filename and language; Esc closes', async () => {
    snippetFetches.length = 0;
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(createElement(CodeSnippetFullscreen, { slug: 'one', onClose }));
    });
    await flush();
    expect(snippetFetches).toEqual(['one']);
    const dialog = document.querySelector('[data-testid="code-snippet-fullscreen"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.textContent).toContain('src/manifest.ts');
    expect(dialog.textContent).toContain('export const manifest');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
    host.remove();
  });

  it('[ac:ac-codesnippetfullscreen-otwarty-z-karty] opened from the card (BLOCK, Maximize2): the window payload is `{ slug }` and the same component resolves the record by slug — the card hands over nothing', async () => {
    const record = {
      slug: 'one',
      title: 'From the card',
      language: 'py',
      filename: 'card/held.py',
      code: 'print("held by the card")',
    };
    // The card holds its own record; its Maximize2 button only calls the host's onOpen.
    const cardHost = document.createElement('div');
    document.body.appendChild(cardHost);
    const cardRoot = createRoot(cardHost);
    const onOpen = vi.fn();
    await act(async () => {
      cardRoot.render(
        createElement(codeSnippetFrontendModule.renderCard as never, { slug: 'one', entity: record, onOpen }),
      );
    });
    await flush();
    const maximize = cardHost.querySelector('button[aria-label="Open fullscreen"]') as HTMLButtonElement;
    expect(maximize).not.toBeNull();
    snippetFetches.length = 0;
    await act(async () => {
      maximize.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]).toEqual([]);

    // The window content the host then mounts — the same renderOverlay component, same props as from a chip.
    expect(codeSnippetFrontendModule.renderOverlay).toBe(CodeSnippetFullscreen);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(createElement(CodeSnippetFullscreen, { slug: 'one', onClose: () => {} }));
    });
    await flush();
    // Resolved by slug, not taken from the card.
    expect(snippetFetches).toEqual(['one']);
    const dialog = host.querySelector('[data-testid="code-snippet-fullscreen"]') as HTMLElement;
    expect(dialog.textContent).toContain('src/manifest.ts');
    expect(dialog.textContent).toContain('export const manifest');
    expect(dialog.textContent).not.toContain('held by the card');
    await act(async () => r.unmount());
    await act(async () => cardRoot.unmount());
    host.remove();
    cardHost.remove();
  });
});

// ─── spreadsheet ────────────────────────────────────────────────────────────

describe('spreadsheet — L11 envelope', () => {
  it('[section:k7v3qm2d] card and chip, no renderRow / sidebarTab / routes; a chip click is routed by the host to `spreadsheet-expand` with renderOverlay content', () => {
    expectHiddenModule('spreadsheet', SpreadsheetFullscreen);
    expect(listPickerEntityTypes('element')).toContain('spreadsheet');
    expect(listPickerEntityTypes('list')).not.toContain('spreadsheet');
    expectHostRoutedExpand('spreadsheet', { slug: 'one', nRows: 2, nCols: 2 });
  });

  it('[section:fbgmkqw7] the frontend is not in the contribution; the browser entry registers the module with registerFrontendModule; renderOverlay is SpreadsheetFullscreen; no editor extensions', () => {
    expectContributionWithoutFrontend(spreadsheetsManifest as never, 'spreadsheet');
    const mods = byEntry.get('c4s-plugin-spreadsheets') ?? [];
    expect(mods).toHaveLength(1);
    expect(mods[0]).toBe(spreadsheetFrontendModule);
    expect(clientPluginHost.getAvailable('spreadsheet')).toBe(spreadsheetFrontendModule);
    const mod = expectHiddenModule('spreadsheet', SpreadsheetFullscreen);
    expect(mod.editorExtensions ?? []).toHaveLength(0);
  });
});

// ─── spec-operation (host contract for its presentation table) ──────────────
// ASSUMPTION:dev-2006 — the spec-operation module lives in the specification
// repository's project-local plugin, outside this repo; what this repo owns is
// the host contract its slot table relies on.

describe('spec-operation — the presentation table\'s slot set', () => {
  it('[section:31if7sjf] chip, card and row but no sidebar tab, no routes/detailPanel and no editorExtensions register with the host — listable but tab-less; no client-state slot exists', () => {
    const Noop = (() => null) as unknown as FrontendModule['renderChip'];
    const specOperationShape = {
      type: 'spec-operation-shape',
      data: { schema: {} },
      slugPattern: [{ op: 'literal', value: 'x' }],
      payloadVersion: 1,
      label: 'Spec operation',
      labelPlural: 'Spec operations',
      pathPrefix: '/spec-operations',
      renderChip: Noop,
      renderCard: Noop,
      renderRow: Noop,
      renderOverlay: Noop,
      useGetBySlug: () => ({ data: null, isLoading: false }),
      listByTags: async () => [],
    } as unknown as FrontendModule;
    expect(checkSlotShapes(specOperationShape)).toBeNull();
    clientPluginHost.registerFrontendModule(specOperationShape);
    expect(listPickerEntityTypes('list')).toContain('spec-operation-shape');
    expect(isHiddenModule(specOperationShape)).toBe(true);
    expect(specOperationShape.sidebarTab).toBeUndefined();
    expect(specOperationShape.editorExtensions).toBeUndefined();

    // `stateSlice` is gone from the contract: `FrontendModule` has no such key.
    type HasStateSlice = 'stateSlice' extends keyof FrontendModule ? true : false;
    const hasStateSlice: HasStateSlice = false;
    expect(hasStateSlice).toBe(false);
    expect(codeOf('src/client/core/plugin-host/types.ts')).not.toMatch(/stateSlice/);
  });
});

// ─── the criterion ──────────────────────────────────────────────────────────

describe('hidden entity — criterion', () => {
  it('[ac:ac-encja-ukryta-bez-sidebartab-i-trasy-d] diagram and spreadsheet supply renderCard, renderChip (a click opens `<type>-expand` with renderOverlay content instead of bridge.openEntity) and renderOverlay, but not renderRow — element_list and tagged_list do not support them', () => {
    for (const [type, overlay, entity] of [
      ['diagram', DiagramOverlay, DIAGRAM],
      ['spreadsheet', SpreadsheetFullscreen, { slug: 'one', nRows: 2, nCols: 2 }],
    ] as const) {
      const mod = expectHiddenModule(type, overlay);
      expect(typeof mod.renderCard).toBe('function');
      expect(typeof mod.renderOverlay).toBe('function');
      expectHostRoutedExpand(type, entity);
      // Without renderRow neither list form offers the type …
      expect(listPickerEntityTypes('list')).not.toContain(type);
    }
    // … and both list views answer a row-less type with the not-listable placeholder.
    for (const view of ['ElementList.tsx', 'TaggedList.tsx']) {
      expect(codeOf(`src/client/xml-markup/tags/references/${view}`)).toMatch(
        /if \(!def\.renderRow\) return <NotListable/,
      );
    }
  });
});
