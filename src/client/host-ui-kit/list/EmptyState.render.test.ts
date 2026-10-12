import { describe, it, expect, expectTypeOf } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState, type EmptyStateProps } from './EmptyState.js';

/**
 * M19 `m19l12sc` (2.1.19) — `EmptyState` covers both cases of an empty entity
 * list with one component: no entities at all, and no results for the current
 * filter. The type tells the two apart by text only (no variant prop, no error
 * state).
 */

const render = (props: EmptyStateProps) => renderToStaticMarkup(createElement(EmptyState, props));

describe('EmptyState — both empty-list cases (M19 m19l12sc)', () => {
  it('[section:m19l12sc] one component renders both "no entities" and "no filter results", told apart only by the text the type passes', () => {
    const noEntities = render({
      title: 'No endpoints yet',
      hint: 'Create the first endpoint to get started.',
      action: createElement('button', { type: 'button' }, 'New endpoint'),
    });
    const noResults = render({
      title: 'No endpoints match the filter',
      hint: 'Clear the search or tag filter to see all endpoints.',
      action: createElement('button', { type: 'button' }, 'Clear filters'),
    });

    // Each case shows the type's own text.
    expect(noEntities).toContain('No endpoints yet');
    expect(noEntities).toContain('Create the first endpoint to get started.');
    expect(noEntities).toContain('New endpoint');
    expect(noResults).toContain('No endpoints match the filter');
    expect(noResults).toContain('Clear the search or tag filter to see all endpoints.');
    expect(noResults).toContain('Clear filters');
    expect(noResults).not.toContain('No endpoints yet');

    // Same component, same markup — only the text differs.
    const shape = (html: string) => html.replace(/>[^<]+</g, '><');
    expect(shape(noEntities)).toBe(shape(noResults));
  });

  it('[section:m19l12sc] the contract is text-only: title, optional hint and action — no variant, no error state', () => {
    expectTypeOf<keyof EmptyStateProps>().toEqualTypeOf<'title' | 'hint' | 'action'>();
    // A title alone is a complete empty state (the minimal "no results" case).
    const html = render({ title: 'No results' });
    expect(html).toContain('No results');
    expect(html).not.toContain('<button');
  });
});
