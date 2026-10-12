import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { List } from 'lucide-react';
import { EntityListHeader, type EntityListHeaderProps } from './EntityListHeader.js';
import { UI_KIT_CATALOG } from '../registry.js';

/**
 * M19 `m19l12sc` (2.1.16) — `EntityListHeader` has an explicit prop contract
 * with no default values: `title` required; `icon`, `count` ("N results"),
 * `search` / `onSearchChange` / `searchPlaceholder`, `filters`, `actions`
 * optional. Omitting `search` hides the search box; the `filters` slot stands
 * between search and actions, `actions` at the trailing edge. The list-page
 * pattern has one empty state and the catalog has no error state.
 */

const render = (props: EntityListHeaderProps) => renderToStaticMarkup(createElement(EntityListHeader, props));

describe('EntityListHeader — prop contract (M19 m19l12sc)', () => {
  it('[section:m19l12sc] only the title is required; nothing optional is rendered by default', () => {
    // Type-level: `title` alone satisfies the contract.
    const minimal: EntityListHeaderProps = { title: 'Endpoints' };
    const html = render(minimal);
    expect(html).toContain('Endpoints');
    expect(html).not.toContain('<input');
    expect(html).not.toMatch(/results?</);
    expect(html).not.toContain('<svg');
  });

  it('[section:m19l12sc] count renders as "N results"; search renders with its placeholder', () => {
    const html = render({
      icon: List,
      title: 'Endpoints',
      count: 3,
      search: 'abc',
      onSearchChange: () => {},
      searchPlaceholder: 'Search endpoints…',
    });
    expect(html).toContain('3 results');
    expect(html).toContain('value="abc"');
    expect(html).toContain('placeholder="Search endpoints…"');
    expect(html).toContain('<svg');
  });

  it('[section:m19l12sc] slot order: search, then filters, then actions at the trailing edge', () => {
    const html = render({
      title: 'Endpoints',
      search: '',
      onSearchChange: () => {},
      filters: createElement('span', { 'data-slot': 'filters' }),
      actions: createElement('span', { 'data-slot': 'actions' }),
    });
    const iSearch = html.indexOf('<input');
    const iFilters = html.indexOf('data-slot="filters"');
    const iActions = html.indexOf('data-slot="actions"');
    expect(iSearch).toBeGreaterThan(-1);
    expect(iSearch).toBeLessThan(iFilters);
    expect(iFilters).toBeLessThan(iActions);
    // `actions` is the last thing in the header.
    expect(html.slice(iActions)).toMatch(/^data-slot="actions"><\/span><\/div>$/);
  });

  it('[section:m19l12sc] the list catalog offers one empty state and no error state', () => {
    const names = UI_KIT_CATALOG.map((c) => c.name);
    expect(names).toContain('EmptyState');
    expect(names).toContain('LoadingState');
    expect(names.filter((n) => /error/i.test(n))).toEqual([]);
  });
});
