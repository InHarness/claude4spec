/**
 * 2.1.9 — M20 `m20l13rt` gated behaviour (3) on the page editor of a `skills`
 * package file (M52): a root of a kind other than `pages` that did not select
 * `m06-anchor-injection` gets neither the `@` autocomplete nor the `PageRefNode`,
 * so `@path.md` written there stays prose.
 *
 * The layers come from `rootEditorPropsForRoot` — the function the page editor
 * (`useRootEditorProps`) answers with — so these pin the editor of
 * `/space/skills/<package>/…`, not a hand-made layer set. The `@` parse is
 * checked on the markdown-it the editor builds: `tiptap-markdown` runs the
 * `parse.setup` of every mounted extension on one instance, and the same loop
 * runs here over the list `EditorFactory` returns.
 */

import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import './registrations.js';
import { EditorFactory } from './EditorFactory.js';
import {
  getContextSpec,
  getMentionSourceByTrigger,
  getRegisteredMentionSources,
  type RegistryContext,
  type RootEditorProps,
} from './registry.js';
import { FULL_ROOT_EDITOR_PROPS, rootEditorPropsForRoot } from './contextSpec.js';
import { kindSelects } from '../../shared/root-kinds.js';

const ctx: RegistryContext = {
  qc: {} as RegistryContext['qc'],
  currentPath: 'writer/SKILL.md',
  rootId: 'skills',
  onSlashInvoke: () => {},
  getAnnotations: () => [],
};

const names = (list: { name: string }[]) => list.map((e) => e.name);

/** The markdown-it of a page editor with `layers`: every mounted extension's `parse.setup`, in mount order. */
function editorMarkdownIt(layers: RootEditorProps): MarkdownIt {
  const md = new MarkdownIt({ html: true, breaks: false, linkify: false });
  for (const ext of EditorFactory.buildExtensions('page', ctx, {}, layers)) {
    const spec = (ext as unknown as { storage?: { markdown?: { parse?: { setup?: (md: MarkdownIt) => void } } } })
      .storage?.markdown;
    spec?.parse?.setup?.call({ editor: undefined, options: (ext as unknown as { options: unknown }).options }, md);
  }
  return md;
}

describe('the page editor of a `skills` package file (M20 m20l13rt, M52)', () => {
  it('the `skills` root is a kind other than `pages` that selects no `m06-anchor-injection` — its editor gets no anchors and no `@`', () => {
    expect(kindSelects('skills', 'm06-anchor-injection')).toBe(false);
    expect(rootEditorPropsForRoot('skills')).toEqual({ sectionIndexed: false, referenceValidated: true, pageLinks: false });
    // A user root keeps the `pages` layers — and the same object, so the editor is not rebuilt.
    expect(rootEditorPropsForRoot('pages')).toBe(FULL_ROOT_EDITOR_PROPS);
    expect(rootEditorPropsForRoot('skills')).toBe(rootEditorPropsForRoot('skills'));
  });

  it('[ac:m20-rodzaj-bez-kotwic-bez-at] typing `@` in a `skills` package file opens no page list: no mention extension, no `@` source', () => {
    const layers = rootEditorPropsForRoot('skills');
    const mounted = names(EditorFactory.buildExtensions('page', ctx, {}, layers));
    // The `@` suggestion plugin is the mention extension — not mounted, so `@` is a plain character.
    expect(mounted).not.toContain('mention_extension');
    expect(getContextSpec('page', layers).mentions).toEqual([]);
    expect(getRegisteredMentionSources('page', layers)).toEqual([]);
    expect(getMentionSourceByTrigger('@', 'page', layers)).toBeUndefined();
    // Control: a `pages` root's editor does open the page list on `@`.
    expect(names(EditorFactory.buildExtensions('page', ctx, {}, FULL_ROOT_EDITOR_PROPS))).toContain('mention_extension');
    expect(getMentionSourceByTrigger('@', 'page', FULL_ROOT_EDITOR_PROPS)?.id).toBe('files');
  });

  it('[ac:m20-rodzaj-bez-kotwic-at-proza] `@path.md` in a `skills` package file shows as text, not as a page chip', () => {
    const source = 'Read @guides/intro.md first.\n';
    const layers = rootEditorPropsForRoot('skills');
    // No page-ref node in the schema to turn it into…
    expect(names(EditorFactory.buildExtensions('page', ctx, {}, layers))).not.toContain('page_ref');
    // …and the editor's parser leaves it as prose.
    const html = editorMarkdownIt(layers).render(source);
    expect(html).not.toContain('data-page-ref');
    expect(html).toContain('Read @guides/intro.md first.');
    // Control: the same line in a `pages` root's editor becomes the chip.
    const pagesHtml = editorMarkdownIt(FULL_ROOT_EDITOR_PROPS).render(source);
    expect(pagesHtml).toContain('data-page-ref="true"');
    expect(pagesHtml).toContain('data-path="guides/intro.md"');
  });
});
