/**
 * 2.1.8 (M14) — the editor's `@` suggestions follow the resolution precedence:
 * source page's root, then `builtin`, then `roots[]` order. The server picks the
 * winning root per path (`pages-link-indexer.test.ts`), but only if the editor
 * tells it which root the page being edited lives in. These tests pin that the
 * root travels the whole client path: the page editor's `RegistryContext.rootId`
 * → `MentionExtension` options → the `files` source's `search` → the
 * `GET /api/page-links/autocomplete?root=…` request — and that the suggestion the
 * server answers from that root is what the popup offers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import './registrations.js';
import {
  getEditorExtensionsForContext,
  getMentionSourceByTrigger,
  type RegistryContext,
} from './registry.js';
import { mentionItems } from './extensions/MentionExtension.js';

const baseCtx: RegistryContext = {
  qc: {} as RegistryContext['qc'],
  currentPath: 'src.md',
  onSlashInvoke: () => {},
  getAnnotations: () => [],
};

type Suggestion = { path: string; title: string; matchScore: number; rootId?: string };

/** A fake server: answers from `root` (when given) or from `builtin` otherwise. */
function stubAutocompleteServer(byRoot: Record<string, Suggestion[]>, builtin: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const root = url.searchParams.get('root') ?? builtin;
    return new Response(JSON.stringify({ suggestions: byRoot[root] ?? [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mentionOptions(ctx: RegistryContext, contextId: 'page' | 'plan') {
  const ext = getEditorExtensionsForContext(ctx, contextId).find((e) => e.name === 'mention_extension');
  expect(ext).toBeDefined();
  return ext!.options as { rootId?: string | null };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('`@` suggestions carry the source page root (2.1.8)', () => {
  it('[ac:ac-resolve-i-autocomplete-path-md-sa-ogran] the page editor asks for suggestions from its own root first, so a path in several roots is offered from the source root', async () => {
    const fetchMock = stubAutocompleteServer(
      {
        a: [{ path: 'x.md', title: 'X in a', matchScore: 1, rootId: 'a' }],
        pages: [{ path: 'x.md', title: 'X in pages', matchScore: 1, rootId: 'pages' }],
      },
      'pages',
    );

    // The page editor of a page in root `a` mounts the mention extension with that root…
    const options = mentionOptions({ ...baseCtx, rootId: 'a' }, 'page');
    expect(options.rootId).toBe('a');

    // …and the `@` source hands it to the autocomplete request.
    const source = getMentionSourceByTrigger('@', 'page')!;
    expect(source.id).toBe('files');
    const items = (await mentionItems(source, 'x', { rootId: options.rootId ?? null })) as Suggestion[];

    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(url.pathname).toMatch(/\/page-links\/autocomplete$/);
    expect(url.searchParams.get('q')).toBe('x');
    expect(url.searchParams.get('root')).toBe('a');
    // The popup offers the source root's page, not the builtin root's namesake.
    expect(items).toEqual([expect.objectContaining({ path: 'x.md', rootId: 'a', title: 'X in a' })]);
  });

  it('[ac:ac-resolve-i-autocomplete-path-md-sa-ogran] outside a page (a plan) no root is sent, so suggestions start at the builtin root', async () => {
    const fetchMock = stubAutocompleteServer(
      {
        a: [{ path: 'x.md', title: 'X in a', matchScore: 1, rootId: 'a' }],
        pages: [{ path: 'x.md', title: 'X in pages', matchScore: 1, rootId: 'pages' }],
      },
      'pages',
    );

    const options = mentionOptions({ ...baseCtx, currentPath: '/plans/p.md' }, 'plan');
    expect(options.rootId).toBeNull();

    const source = getMentionSourceByTrigger('@', 'plan')!;
    const items = (await mentionItems(source, 'x', { rootId: options.rootId ?? null })) as Suggestion[];

    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(url.searchParams.has('root')).toBe(false);
    expect(items).toEqual([expect.objectContaining({ path: 'x.md', rootId: 'pages', title: 'X in pages' })]);
  });
});
