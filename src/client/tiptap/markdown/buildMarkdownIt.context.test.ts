/**
 * 2.1.8 — M20 `c03ijrki` / `m20l13rt`: the page editor's context comes from
 * the root's KIND, and briefs / patches mount the fixed `artifact` context.
 *
 * Pinned on what the user sees: the same markdown, parsed the way each editor
 * parses it (`buildMarkdownIt({ context })` follows the context's whitelist,
 * exactly like the raw-JSX / XML / anchor rules the mounted extensions install)
 * and checked against the schema `EditorFactory` builds for that context.
 */

import { describe, expect, it } from 'vitest';
import '../registrations.js';
import { buildMarkdownIt } from './buildMarkdownIt.js';
import { EditorFactory } from '../EditorFactory.js';
import { getContextSpec, rootEditorPropsForKind, type RegistryContext } from '../registry.js';
import { PAGES_KIND } from '../../../shared/root-kinds.js';
import { unescapeRawAttr } from '../../../shared/raw-jsx-escape.js';

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
  `The form posts ${MENTION} — see @modules/m01-auth.md for the flow.`,
  '',
].join('\n');

const names = (list: { name: string }[]) => list.map((e) => e.name);

function rawPayloads(html: string): string[] {
  return [...html.matchAll(/data-c4s-raw="([^"]*)"/g)].map((m) => unescapeRawAttr(m[1]!));
}

describe('page context from the root kind, fixed `artifact` context for briefs and patches', () => {
  it('[ac:ac-editorfactory-buduje-editorcontextspec-d] the same content on a pages root renders with entity chips and anchors', () => {
    // The page editor's layers come from the `pages` kind: anchors (the kind
    // selects `m06-anchor-injection`) and entity nodes (`references = tak`).
    const layers = rootEditorPropsForKind(PAGES_KIND);
    expect(layers).toEqual({ sectionIndexed: true, referenceValidated: true });
    const schema = names(EditorFactory.buildExtensions('page', ctx, {}, layers));
    expect(schema).toEqual(expect.arrayContaining(['inline_mention', 'anchor_marker', 'section_ref', 'page_ref']));

    const html = buildMarkdownIt({ context: 'page' }).render(CONTENT);
    // Entity chip: the mention becomes its node, not raw text.
    expect(html).toContain('<inline_mention type="dto" slug="user"></inline_mention>');
    // Anchor: the anchor comment becomes the marker node.
    expect(html).toContain('<anchor_marker id="abcd1234"></anchor_marker>');
    // `@` link.
    expect(html).toContain('data-page-ref="true"');
    expect(html).toContain('data-path="modules/m01-auth.md"');
    expect(rawPayloads(html)).toEqual([]);
  });

  it('[ac:ac-editorfactory-buduje-editorcontextspec-d] the same content in the `artifact` context (brief, patch) renders as prose with `@` links', () => {
    // Fixed context: the caller's layers are ignored — a brief/patch names the
    // context and gets prose + `@`, whatever layer set it might pass.
    const spec = getContextSpec('artifact', rootEditorPropsForKind(PAGES_KIND));
    expect(spec.id).toBe('artifact');
    expect(spec.mentions).toEqual(['files']);
    const schema = names(EditorFactory.buildExtensions('artifact', ctx));
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
    expect(html).toContain('data-path="modules/m01-auth.md"');
  });
});
