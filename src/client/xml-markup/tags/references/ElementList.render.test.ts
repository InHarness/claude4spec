import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * M19 `m19broken` (2.1.16) — a deleted entity on an element list: the host
 * renders no row for the missing slug at all. `element_list` skips it, and the
 * type's `renderRow` slot only ever receives a resolved entity — there is no
 * `null` branch, and the slug is not degraded to a (broken) chip either.
 */

interface Row {
  slug: string;
  title: string;
}

const ENTITIES: Record<string, Row> = {
  'kept-a': { slug: 'kept-a', title: 'Kept A' },
  'kept-b': { slug: 'kept-b', title: 'Kept B' },
};

const rowCalls: Array<{ slug: string; entity: unknown }> = [];
const chipCalls: string[] = [];

function RenderRow({ slug, entity }: { slug: string; entity: Row }) {
  rowCalls.push({ slug, entity });
  return createElement('span', { 'data-row': slug }, entity.title);
}

function RenderChip({ slug }: { slug: string }) {
  chipCalls.push(slug);
  return createElement('span', { 'data-chip': slug }, `[broken: ${slug}]`);
}

const def = {
  type: 'endpoint',
  label: 'Endpoint',
  labelPlural: 'Endpoints',
  renderRow: RenderRow,
  renderChip: RenderChip,
  renderCard: RenderChip,
  // Resolved synchronously: a present slug has its entity, a deleted one `null`.
  useGetBySlug: (slug: string | null) => ({
    data: slug && ENTITIES[slug] ? ENTITIES[slug] : null,
    isLoading: false,
  }),
};

vi.mock('../../../entities/registry.js', () => ({
  getEntityDef: (type: string) => (type === 'endpoint' ? def : null),
}));
vi.mock('../../../core/plugin-host/useRegistryVersion.js', () => ({ useRegistryVersion: () => 0 }));
vi.mock('../../../core/plugin-host/host.js', () => ({
  categoriseBrokenChip: () => 'unknown-type',
  clientPluginHost: { getEntity: () => null, onRegistryChanged: () => () => {} },
}));
vi.mock('../../../entities/openEntity.js', () => ({ openEntityHandler: () => undefined }));
// ElementList → shared → ChipResolver → state/brokenRefs reads the plugins-ready
// signal (`runtime/plugin-boot-signal`). Report the boot as settled, so an
// unresolved type counts as broken here as it does after the boot.
vi.mock('../../../runtime/plugin-boot-signal.js', () => ({
  frontendPluginsBooted: Promise.resolve(),
  pluginBootPending: () => false,
  settlePluginBoot: () => {},
}));

const { ElementListRender } = await import('./ElementList.js');

const render = (slugs: string) =>
  renderToStaticMarkup(
    createElement(ElementListRender, {
      name: 'element_list',
      attrs: { type: 'endpoint', slugs },
      variant: 'block',
    }),
  );

beforeEach(() => {
  rowCalls.length = 0;
  chipCalls.length = 0;
});

describe('element_list — slug of a deleted entity (M19 m19broken)', () => {
  it('[ac:ac-slug-usunietej-encji-w-element-list-n] a deleted slug yields no row on the rendered list', () => {
    const html = render('kept-a,deleted-x,kept-b');
    const items = html.match(/<li[\s>]/g) ?? [];
    // Two resolved slugs → exactly two rows; the deleted slug adds none.
    expect(items).toHaveLength(2);
    expect(html).toContain('data-row="kept-a"');
    expect(html).toContain('data-row="kept-b"');
    expect(html).not.toContain('deleted-x');
    // Not degraded to a chip either: no chip slot is rendered for it.
    expect(chipCalls).toEqual([]);
  });

  it('[section:m19broken] renderRow receives only a resolved entity — no null branch', () => {
    render('deleted-x,kept-a,deleted-y');
    expect(rowCalls.map((c) => c.slug)).toEqual(['kept-a']);
    for (const call of rowCalls) expect(call.entity).not.toBeNull();
  });

  it('[section:m19broken] a list whose every slug is deleted renders no row at all', () => {
    const html = render('deleted-x,deleted-y');
    expect(html.match(/<li[\s>]/g) ?? []).toHaveLength(0);
    expect(rowCalls).toEqual([]);
    expect(chipCalls).toEqual([]);
  });
});
