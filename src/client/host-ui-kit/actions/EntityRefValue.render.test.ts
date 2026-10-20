// @vitest-environment happy-dom
/**
 * 2.1.41 (M34) — `EntityRefValue` (group `actions`, `experimental`,
 * presentational, composes `badge`): a field value that is a link to a record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Database } from 'lucide-react';

const { openEntity, getEntity, openEntityOverlay } = vi.hoisted(() => ({
  openEntity: vi.fn(),
  getEntity: vi.fn(),
  openEntityOverlay: vi.fn(),
}));
vi.mock('../../ui/events.js', () => ({ openEntityOverlay }));
vi.mock('../../runtime/editor-bridge.js', () => ({ editorBridge: { openEntity } }));
vi.mock('../../core/plugin-host/host.js', () => ({ clientPluginHost: { getEntity } }));

import { EntityRefValue, type RefLookupEntry } from './EntityRefValue.js';
import { UI_KIT_CATALOG, UI_KIT_STABLE_COMPONENTS } from '../registry.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  openEntity.mockReset();
  openEntityOverlay.mockReset();
  // An active type WITH a detail route: a click navigates through the bridge.
  getEntity.mockReset().mockReturnValue({ type: 'endpoint', routes: {}, detailPanel: () => null });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const resolved: RefLookupEntry = { title: 'GET /users', icon: Database };

function render(el: ReturnType<typeof createElement>) {
  act(() => root.render(el));
}

describe('EntityRefValue', () => {
  it('[ac:ac-klik-w-entityrefvalue-otwiera-rekord] a click opens the target record, then calls onOpen', () => {
    const onOpen = vi.fn();
    render(createElement(EntityRefValue, { type: 'endpoint', slug: 'get-users', refEntry: resolved, onOpen }));
    const button = host.querySelector('button')!;
    act(() => button.click());
    expect(openEntity).toHaveBeenCalledWith('endpoint', 'get-users');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('[ac:ac-klik-w-entityrefvalue-wewnatrz-wiersz] a click inside a list row does not open the row', () => {
    const openRow = vi.fn();
    render(
      createElement(
        'div',
        { onClick: openRow, role: 'button' },
        createElement(EntityRefValue, { label: 'Endpoint', type: 'endpoint', slug: 'get-users', refEntry: resolved }),
      ),
    );
    act(() => host.querySelector('.entity-ref-value button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(openEntity).toHaveBeenCalledWith('endpoint', 'get-users');
    expect(openRow).not.toHaveBeenCalled();
  });

  it('[ac:ac-entityrefvalue-w-stanie-zerwanym-nie] in the broken state it does not react to a click', () => {
    const onOpen = vi.fn();
    const openRow = vi.fn();
    for (const refEntry of [undefined, { ...resolved, title: 'gone', broken: 'deleted' as const }]) {
      render(createElement('div', { onClick: openRow }, createElement(EntityRefValue, { type: 'endpoint', slug: 'gone', refEntry, onOpen })));
      const value = host.querySelector('.entity-ref-value')!;
      // No handler, no button, no link cursor — a broken Badge with the slug.
      expect(value.querySelector('button, a, [role="button"]')).toBeNull();
      expect(value.querySelector('.value-badge')!.textContent).toContain('gone');
      act(() => (value.querySelector('.value-badge') as HTMLElement).click());
      expect(openEntity).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
    }
  });

  it('gives the cause of a broken value in its tooltip, per class', () => {
    const cases: Array<[RefLookupEntry['broken'] | undefined, RegExp]> = [
      ['deleted', /deleted entity/],
      ['inactive', /inactive package/],
      ['unknown', /unknown type/],
      [undefined, /record not found/],
    ];
    for (const [broken, reason] of cases) {
      const refEntry = broken ? { ...resolved, title: 'x', broken } : undefined;
      render(createElement(EntityRefValue, { type: 'endpoint', slug: 'x', refEntry }));
      expect(host.querySelector('[title]')!.getAttribute('title')).toMatch(reason);
    }
  });

  it('[ac:ac-entityrefvalue-pokazuje-ikone-typu-do] shows the target type\'s icon next to the record\'s display name', () => {
    render(createElement(EntityRefValue, { type: 'endpoint', slug: 'get-users', refEntry: resolved }));
    const button = host.querySelector('button')!;
    const [icon, name] = Array.from(button.children);
    expect(icon!.tagName.toLowerCase()).toBe('svg');
    expect(icon!.getAttribute('class')).toContain('lucide-database');
    expect(name!.textContent).toBe('GET /users');
  });

  it('opens a hidden type in its <type>-expand window rather than navigating', () => {
    getEntity.mockReturnValue({ type: 'diagram' });
    render(createElement(EntityRefValue, { type: 'diagram', slug: 'flow', refEntry: resolved }));
    act(() => host.querySelector('button')!.click());
    expect(openEntityOverlay).toHaveBeenCalledWith({ type: 'diagram', slug: 'flow' });
    expect(openEntity).not.toHaveBeenCalled();
  });

  it('is an experimental, presentational catalog entry in actions, off the stable list', () => {
    const entry = UI_KIT_CATALOG.find((c) => c.name === 'EntityRefValue');
    expect(entry).toEqual({ name: 'EntityRefValue', group: 'actions', stability: 'experimental', binding: 'presentational' });
    expect(UI_KIT_STABLE_COMPONENTS).not.toContain('EntityRefValue');
  });
});
