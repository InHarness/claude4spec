/**
 * 2.1.1 — which entity types a type picker offers.
 *
 * `/element` (and the edit popover of a chip or card) offers every ACTIVE type,
 * hidden ones included: a hidden type like `diagram` has a card and a chip, just
 * no route. `/list` (and `/tagged`, and the edit popover of a list node) offers
 * only the types that render a list row — a `diagram` list would only ever show
 * the "not listable" placeholder.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { clientPluginHost } from '../core/plugin-host/host.js';
import type { FrontendModule } from '../core/plugin-host/types.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import { listPickerEntityTypes } from './registry.js';

const Noop = (() => null) as unknown as FrontendModule['renderChip'];

function moduleOf(type: string, opts: { row: boolean }): FrontendModule {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 900,
    pathPrefix: `/${type}s`,
    renderChip: Noop,
    renderCard: Noop,
    // Hidden, the smallest shape the host accepts (no routes → renderOverlay).
    renderOverlay: Noop,
    ...(opts.row ? { renderRow: Noop } : {}),
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
  } as unknown as FrontendModule;
}

describe('type pickers', () => {
  afterEach(() => clientPluginHost.applyActivation(null));

  clientPluginHost.registerFrontendModule(moduleOf('picker-hidden-no-row', { row: false }));
  clientPluginHost.registerFrontendModule(moduleOf('picker-with-row', { row: true }));

  it('[ac:m20-picker-element-typ-ukryty-dostepny] /element offers a hidden type', () => {
    expect(listPickerEntityTypes('element')).toContain('picker-hidden-no-row');
    expect(listPickerEntityTypes('element')).toContain('picker-with-row');
  });

  it('[ac:m20-picker-list-typ-bez-wiersza-niedostepny] /list leaves out a type with no list row', () => {
    expect(listPickerEntityTypes('list')).not.toContain('picker-hidden-no-row');
    expect(listPickerEntityTypes('list')).toContain('picker-with-row');
  });

  it('the built-in diagram is offered by /element and not by /list', async () => {
    await import('./index.js');
    expect(listPickerEntityTypes('element')).toContain('diagram');
    expect(listPickerEntityTypes('list')).not.toContain('diagram');
  });

  it('neither picker offers an inactive type', () => {
    clientPluginHost.applyActivation({ active: ['picker-with-row'] } as never);
    expect(listPickerEntityTypes('element')).toEqual(['picker-with-row']);
    expect(listPickerEntityTypes('list')).toEqual(['picker-with-row']);
  });
});
