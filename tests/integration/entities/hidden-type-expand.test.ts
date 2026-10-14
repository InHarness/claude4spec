/**
 * 2.1.20 (M13 chipprops) — the `<type>-expand` window of a HIDDEN type, asserted
 * on the four real hidden types whose L5 pages name it: `diagram` (built into
 * the host bundle), `code-snippet`, `spreadsheet` and `module-dependency`.
 *
 * What each page now says: the window's name and the way it opens come from the
 * M13 convention, its content from the type's `renderOverlay` slot. So, per type:
 *   - the frontend module is hidden (no `routes`, no `detailPanel`) and supplies
 *     `renderOverlay` — the slot `ModalHost` resolves `<type>-expand` to;
 *   - a click is routed by the HOST: `openEntityHandler` opens the shell modal
 *     `<type>-expand` with `{ slug }` and never reaches `editorBridge.openEntity`;
 *   - the chip opens nothing itself — its click handler IS the host's `onOpen`,
 *     and without one it has none.
 *
 * Lives under `tests/` because it imports the envelopes' own frontend modules,
 * which the client tsconfig does not compile. Runs under `node`, like
 * `src/client/entities/openEntity.test.ts`: `openEntityOverlay` only
 * dispatches a window event, so a `window` / `CustomEvent` stub is all it needs.
 * The diagram card module is replaced by stubs (its form is the diagram page's
 * business, not this one's); what is asserted is that the registered overlay
 * IS the module's `DiagramOverlay` export.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../src/client/entities/diagram/DiagramCard.js', () => ({
  DiagramCard: function DiagramCard() {
    return null;
  },
  DiagramOverlay: function DiagramOverlay() {
    return null;
  },
}));
vi.mock('../../../src/client/tiptap/registry.js', () => ({ registerEditorExtension: () => {} }));

import { clientPluginHost } from '../../../src/client/core/plugin-host/host.js';
import { isHiddenModule } from '../../../src/client/core/plugin-host/slot-rules.js';
import type { FrontendModule } from '../../../src/client/core/plugin-host/types.js';
import { openEntityHandler } from '../../../src/client/entities/openEntity.js';
import { UI_EVENTS } from '../../../src/client/ui/events.js';
import * as diagramCard from '../../../src/client/entities/diagram/DiagramCard.js';
import '../../../src/client/entities/diagram/plugin.js';
import { codeSnippetFrontendModule } from '../../../plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/module.js';
import { CodeSnippetFullscreen } from '../../../plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/fullscreen.js';
import { spreadsheetFrontendModule } from '../../../plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/frontend/module.js';
import { SpreadsheetFullscreen } from '../../../plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/frontend/node-view.js';
import { moduleDependencyFrontendModule } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/entity/module-dependency/frontend/module.js';
import { ModuleDependencyOverlay } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/entity/module-dependency/frontend/overlay.js';

const dispatched: Array<{ type: string; detail: unknown }> = [];
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  }
  g.window = { dispatchEvent: (e: { type: string; detail: unknown }) => dispatched.push(e) };

  // The package envelopes register from their browser entries in the app; here
  // the host's own registration door is called with the same modules.
  for (const mod of [codeSnippetFrontendModule, spreadsheetFrontendModule, moduleDependencyFrontendModule]) {
    clientPluginHost.registerFrontendModule(mod as unknown as FrontendModule);
  }
});

/** Call a chip slot as a function component and return the element it draws. */
function drawChip(mod: FrontendModule, entity: unknown, onOpen?: () => void): ReactElement<Record<string, unknown>> {
  const Chip = mod.renderChip as unknown as (p: Record<string, unknown>) => ReactElement<Record<string, unknown>>;
  return Chip({ slug: 'one', entity, ...(onOpen ? { onOpen } : {}) });
}

/**
 * The convention, asserted for one hidden type: module hidden with its own
 * overlay, a click routed by the host to `<type>-expand`, a chip that opens
 * nothing itself.
 */
function assertExpandConvention(type: string, expectedOverlay: unknown, entity: unknown): void {
  const mod = clientPluginHost.getEntity(type);
  expect(mod, type).not.toBeNull();
  expect(isHiddenModule(mod!)).toBe(true);
  expect(mod!.routes).toBeUndefined();
  expect(mod!.detailPanel).toBeUndefined();
  // The window's content is the type's own slot — what `ModalHost` resolves `<type>-expand` to.
  expect(mod!.renderOverlay).toBe(expectedOverlay);

  // The host routes the click: the shell modal `<type>-expand`, never the bridge.
  const bridge = { openEntity: vi.fn() };
  dispatched.length = 0;
  const open = openEntityHandler(type, 'one', bridge);
  expect(open).toBeTypeOf('function');
  open!();
  expect(bridge.openEntity).not.toHaveBeenCalled();
  expect(dispatched).toHaveLength(1);
  expect(dispatched[0]!.type).toBe(UI_EVENTS.MODAL);
  expect(dispatched[0]!.detail).toMatchObject({ kind: `${type}-expand`, props: { slug: 'one' } });

  // The chip opens nothing itself: its click handler is exactly the host's
  // `onOpen`, and without one it has none. Drawing it dispatches nothing.
  dispatched.length = 0;
  const onOpen = vi.fn();
  expect(drawChip(mod!, entity, onOpen).props.onClick).toBe(onOpen);
  expect(drawChip(mod!, entity).props.onClick).toBeUndefined();
  expect(dispatched).toHaveLength(0);
}

describe('hidden types — the `<type>-expand` window is the host\'s, its content the type\'s renderOverlay', () => {
  it('[section:dgml5000] diagram: a click opens `diagram-expand` through the host; the chip opens nothing itself', () => {
    assertExpandConvention('diagram', diagramCard.DiagramOverlay, {
      slug: 'one',
      title: 'One',
      format: 'mermaid',
    });
  });

  it('[section:c8sqlv76] code-snippet: a click opens `code-snippet-expand` through the host; neither chip nor card opens it itself', () => {
    assertExpandConvention('code-snippet', CodeSnippetFullscreen, {
      slug: 'one',
      title: 'One',
      language: 'ts',
      code: 'export const x = 1;',
    });

    // The card's expand button calls the host's `onOpen` and nothing else: with
    // no handler (an unresolvable reference) there is no button at all, so the
    // card has no way of opening the window on its own.
    const Card = codeSnippetFrontendModule.renderCard;
    const record = { slug: 'one', title: 'One', language: 'ts', code: 'export const x = 1;' };
    const withHandler = renderToStaticMarkup(
      createElement(Card as never, { slug: 'one', entity: record, onOpen: () => {} }),
    );
    const withoutHandler = renderToStaticMarkup(createElement(Card as never, { slug: 'one', entity: record }));
    expect(withHandler).toContain('aria-label="Open fullscreen"');
    expect(withoutHandler).not.toContain('aria-label="Open fullscreen"');
  });

  it('[section:s7ao66dy] spreadsheet: a click opens `spreadsheet-expand` through the host; the chip opens nothing itself', () => {
    assertExpandConvention('spreadsheet', SpreadsheetFullscreen, { slug: 'one', nRows: 2, nCols: 2 });
  });

  it('[section:gplp0apf] module-dependency: hidden but listable, a click opens `module-dependency-expand` through the host', () => {
    // Listable through its row — and still hidden: the row does not give it a route.
    expect(moduleDependencyFrontendModule.renderRow).toBeTypeOf('function');
    assertExpandConvention('module-dependency', ModuleDependencyOverlay, {
      slug: 'one',
      dependent: 'm1',
      provider: 'm2',
      needs: 'the m2 read API',
    });
  });
});
