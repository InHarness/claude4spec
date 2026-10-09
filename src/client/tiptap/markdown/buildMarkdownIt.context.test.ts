/**
 * 2.1.8 — M20 `c03ijrki` / `m20l13rt`: the page editor's context comes from
 * the root's KIND, and briefs / patches mount the fixed `artifact` context.
 *
 * Pinned on what the user sees: the same markdown, rendered by
 * `buildMarkdownIt({ context })` (the read-only renderer, which gates its rules
 * on the context's whitelist) and checked against the schema `EditorFactory`
 * builds for that context. The editors themselves parse through the mounted
 * extensions' `parse.setup` (`raw_jsx_*` read `mountedTags`), so each case also
 * pins that the factory configures those nodes with the very whitelist the
 * renderer gates on — if the editor gating moves, the two stop agreeing here.
 */

import { describe, expect, it } from 'vitest';
import '../registrations.js';
import { buildMarkdownIt } from './buildMarkdownIt.js';
import { EditorFactory } from '../EditorFactory.js';
import { getContextSpec, rootEditorPropsForKind, type RegistryContext } from '../registry.js';
import { PAGES_KIND } from '../../../shared/root-kinds.js';
import { unescapeRawAttr } from '../../../shared/raw-jsx-escape.js';
import { rawTagPredicate } from '../extensions/RawJsxNode.js';

const ctx: RegistryContext = {
  qc: {} as RegistryContext['qc'],
  currentPath: null,
  onSlashInvoke: () => {},
  getAnnotations: () => [],
};

const MENTION = '<inline_mention type="dto" slug="user"/>';
const CONTENT = [
  '<!-- anchor: abcd1234 -->',
  '## Login',
  '',
  `The form posts ${MENTION} — see @modules/m01-auth for the flow.`,
  '',
].join('\n');

const names = (list: { name: string }[]) => list.map((e) => e.name);

/** The `mountedTags` the factory configured on both raw-JSX nodes — what the editor's parse.setup gates on. */
function editorMountedTags(list: { name: string; options?: unknown }[]): Array<readonly string[] | null> {
  return list
    .filter((e) => e.name === 'raw_jsx_inline' || e.name === 'raw_jsx_block')
    .map((e) => (e.options as { mountedTags: readonly string[] | null }).mountedTags);
}

function rawPayloads(html: string): string[] {
  return [...html.matchAll(/data-c4s-raw="([^"]*)"/g)].map((m) => unescapeRawAttr(m[1]!));
}

describe('page context from the root kind, fixed `artifact` context for briefs and patches', () => {
  it('[ac:ac-editorfactory-buduje-editorcontextspec-d] the same content on a pages root renders with entity chips and anchors', () => {
    // The page editor's layers come from the `pages` kind: anchors (the kind
    // selects `m06-anchor-injection`) and entity nodes (`references = tak`).
    const layers = rootEditorPropsForKind(PAGES_KIND);
    expect(layers).toEqual({ sectionIndexed: true, referenceValidated: true, pageLinks: true });
    const extensions = EditorFactory.buildExtensions('page', ctx, {}, layers);
    const schema = names(extensions);
    expect(schema).toEqual(expect.arrayContaining(['inline_mention', 'anchor_marker', 'section_ref', 'page_ref']));
    // The editor's own parse gating: both raw-JSX nodes carry the context's
    // whitelist, under which the mention is parsed as its node, not raw text.
    const mounted = editorMountedTags(extensions);
    expect(mounted).toHaveLength(2);
    for (const tags of mounted) {
      expect(tags).toEqual(getContextSpec('page', layers).extensions);
      expect(rawTagPredicate(tags)('inline_mention')).toBe(false);
    }

    const html = buildMarkdownIt({ context: 'page' }).render(CONTENT);
    // Entity chip: the mention becomes its node, not raw text.
    expect(html).toContain('<inline_mention type="dto" slug="user"></inline_mention>');
    // Anchor: the anchor comment becomes the marker node.
    expect(html).toContain('<anchor_marker id="abcd1234"></anchor_marker>');
    // `@` link.
    expect(html).toContain('data-page-ref="true"');
    expect(html).toContain('data-path="modules/m01-auth"');
    expect(rawPayloads(html)).toEqual([]);
  });

  it('[ac:ac-editorfactory-buduje-editorcontextspec-d] the same content in the `artifact` context (brief, patch) renders as prose with `@` links', () => {
    // Fixed context: the caller's layers are ignored — a brief/patch names the
    // context and gets prose + `@`, whatever layer set it might pass.
    const spec = getContextSpec('artifact', rootEditorPropsForKind(PAGES_KIND));
    expect(spec.id).toBe('artifact');
    expect(spec.mentions).toEqual(['files']);
    const extensions = EditorFactory.buildExtensions('artifact', ctx);
    const schema = names(extensions);
    // The editor's own parse gating: the mention routes to the raw node.
    const mounted = editorMountedTags(extensions);
    expect(mounted).toHaveLength(2);
    for (const tags of mounted) {
      expect(tags).toEqual(spec.extensions);
      expect(rawTagPredicate(tags)('inline_mention')).toBe(true);
    }
    for (const gone of ['inline_mention', 'single_element', 'anchor_marker', 'section_ref']) {
      expect(schema, gone).not.toContain(gone);
    }
    expect(schema).toEqual(expect.arrayContaining(['page_ref', 'mention_extension']));

    const html = buildMarkdownIt({ context: 'artifact' }).render(CONTENT);
    // No entity chip: the tag stays raw text, byte for byte.
    expect(html).not.toContain('<inline_mention');
    expect(rawPayloads(html)).toEqual([MENTION]);
    // No anchor marker.
    expect(html).not.toContain('<anchor_marker');
    // The `@` link still renders.
    expect(html).toContain('data-page-ref="true"');
    expect(html).toContain('data-path="modules/m01-auth"');
  });
});
