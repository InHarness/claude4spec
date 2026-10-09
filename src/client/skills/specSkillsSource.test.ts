// @vitest-environment happy-dom
/**
 * 2.1.9 — M52 Spec Skills in the chat composer (`chat-input`): the
 * `spec-skills` command source (sheet `wklad-do-edytora-m52`) and what a pick
 * sends to the model.
 *
 * The popover's listing is pinned on `createSlashSession('chat-input')` — the
 * session the composer's `SlashDispatcher` opens per `/` — with the source fed
 * a fixed `chat` listing instead of the REST call.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Node views need a mounted React tree; the serializer under test does not.
vi.mock('@tiptap/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tiptap/react')>()),
  ReactNodeViewRenderer: () => () => ({ dom: document.createElement('span') }),
}));

import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Markdown } from 'tiptap-markdown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../tiptap/registrations.js';
import {
  getContextSpec,
  getEditorExtensionsForContext,
  getSlashCommandSourcesForContext,
  registerSlashCommandSource,
  type RegistryContext,
} from '../tiptap/registry.js';
import { createSlashSession, type SlashPaletteItem } from '../tiptap/slashPalette.js';
import { SlashMenu } from '../tiptap/extensions/SlashMenu.js';
import type { SkillListing } from '../lib/skills-api.js';
import {
  SKILLS_NARROW_ENTRY_ID,
  SPEC_SKILLS_SOURCE_ID,
  createSpecSkillsSource,
  type SpecSkillItem,
} from './specSkillsSource.js';

const ctx: RegistryContext = {
  qc: {} as RegistryContext['qc'],
  currentPath: null,
  onSlashInvoke: () => {},
  getAnnotations: () => [],
};

const LISTING: SkillListing = {
  listing: [
    { slug: 'review-checklist', description: 'Review a page against the checklist', origin: 'project-rooted' },
    { slug: 'house-style', description: 'House writing rules', origin: 'plugin' },
    // Equal to the composer's built-in `/section`.
    { slug: 'section', description: 'A skill named like a built-in command', origin: 'project-exposed', project: 'lib-a' },
  ],
  writingStyle: null,
};

let listing: SkillListing = LISTING;
const readListing = vi.fn(async () => listing);

function useFakeListing(next: SkillListing = LISTING) {
  listing = next;
  readListing.mockClear();
  registerSlashCommandSource(createSpecSkillsSource(readListing));
}

afterEach(() => {
  // Back to the module's own registration (reads the REST listing).
  registerSlashCommandSource(createSpecSkillsSource());
});

const sourceRows = (rows: SlashPaletteItem[]) => rows.filter((r) => r.source?.source.id === SPEC_SKILLS_SOURCE_ID);

async function narrowedSession() {
  const session = createSlashSession('chat-input');
  const full = await session.items('');
  const entry = full.find((r) => r.source?.item.id === SKILLS_NARROW_ENTRY_ID)!;
  expect(entry).toBeDefined();
  session.narrowTo(entry.source!.item.narrowTo!);
  return session;
}

describe('M52 contribution sheet — wklad-do-edytora-m52', () => {
  it('[entity:wklad-do-edytora-m52#spec-skills] a command source in `chat-input`: one `/<slug>` per chat skill with its origin, the built-in command wins a hint collision, `/skills` narrows to the source', async () => {
    // Registered directly, standing in the composer's context, admitted by its whitelist.
    expect(getContextSpec('chat-input').slashCommands).toContain(SPEC_SKILLS_SOURCE_ID);
    const registered = getSlashCommandSourcesForContext('chat-input').find((s) => s.id === SPEC_SKILLS_SOURCE_ID);
    expect(registered?.context).toBe('chat-input');
    // Not offered in a page.
    expect(getSlashCommandSourcesForContext('page').map((s) => s.id)).not.toContain(SPEC_SKILLS_SOURCE_ID);

    useFakeListing();
    const rows = await createSlashSession('chat-input').items('');
    expect(readListing).toHaveBeenCalledTimes(1);
    // Items: id = slug, description, hint = slug, origin marker = listing origin.
    const items = sourceRows(rows).map((r) => r.source!.item as SpecSkillItem);
    expect(items.find((i) => i.id === 'review-checklist')).toMatchObject({
      label: '/review-checklist',
      description: 'Review a page against the checklist',
      hint: 'review-checklist',
      origin: 'project-rooted',
    });
    expect(items.find((i) => i.id === 'house-style')).toMatchObject({ hint: 'house-style', origin: 'plugin' });
    // Collision: `section` is the built-in `/section`'s trigger — the built-in stays, the skill row does not.
    expect(items.map((i) => i.id)).not.toContain('section');
    expect(rows.filter((r) => r.command?.id === 'section')).toHaveLength(1);
    // The fixed `/skills` entry narrows the same popover to this source.
    expect(items.find((i) => i.id === SKILLS_NARROW_ENTRY_ID)).toMatchObject({ label: '/skills', narrowTo: SPEC_SKILLS_SOURCE_ID });
    // The prefix filters by hint.
    expect(sourceRows(await createSlashSession('chat-input').items('rev')).map((r) => r.source!.item.id)).toEqual([
      'review-checklist',
    ]);
    // Pulled at every opening: a skill added between openings shows at the next one.
    useFakeListing({ ...LISTING, listing: [...LISTING.listing, { slug: 'fresh', description: 'new', origin: 'user' }] });
    expect(sourceRows(await createSlashSession('chat-input').items('')).map((r) => r.source!.item.id)).toContain('fresh');
  });
});

describe('the `/skills` entry', () => {
  it('[ac:m52-skills-entry-narrows-popover] picking `/skills` narrows the slash popover to the skill items alone', async () => {
    useFakeListing();
    const session = await narrowedSession();
    expect(session.narrowedTo).toBe(SPEC_SKILLS_SOURCE_ID);
    const rows = await session.items('');
    // Only this source's skills: no built-in command, no `/skills` entry itself.
    expect(rows.every((r) => r.source?.source.id === SPEC_SKILLS_SOURCE_ID && !r.command)).toBe(true);
    expect(rows.map((r) => r.source!.item.id)).toEqual(['review-checklist', 'house-style', 'section']);
    // Typing still filters inside the narrowed view.
    expect((await session.items('house')).map((r) => r.source!.item.id)).toEqual(['house-style']);
  });

  it('[ac:m52-skills-entry-shows-origin-marker] in the `/skills` view every item shows its origin marker beside the label', async () => {
    useFakeListing();
    const rows = await (await narrowedSession()).items('');
    expect(rows.map((r) => [r.label, r.origin])).toEqual([
      ['/review-checklist', 'project-rooted'],
      ['/house-style', 'plugin'],
      ['/section', 'project-exposed'],
    ]);
    // The popover renders the marker next to each row's label.
    const html = renderToStaticMarkup(
      createElement(SlashMenu, { items: rows, command: () => {} } as never),
    );
    expect(html.match(/data-slash-origin=""/g)).toHaveLength(3);
    for (const origin of ['project-rooted', 'plugin', 'project-exposed']) expect(html).toContain(`>${origin}</span>`);
  });
});

describe('M52 edge cases', () => {
  it('[ac:m52-edge-builtin-command-slug-not-in-popover] a skill whose slug is a built-in command is not offered as `/<slug>`, yet stays reachable through `/skills`', async () => {
    useFakeListing();
    const full = await createSlashSession('chat-input').items('sec');
    expect(full.map((r) => r.label)).toEqual(['/section']);
    expect(full[0]!.command?.id).toBe('section');
    expect(sourceRows(full)).toEqual([]);

    const narrowed = await (await narrowedSession()).items('sec');
    expect(narrowed.map((r) => [r.source?.item.id, r.command])).toEqual([['section', undefined]]);
  });
});

describe('a picked skill reaches the model', () => {
  it('[ac:m52-chip-reaches-model-as-skill-ref] the chip picked in the composer leaves it as `<skill_ref slug="x"/>`', async () => {
    useFakeListing();
    const mounted = getEditorExtensionsForContext(ctx, 'chat-input');
    const skillRef = mounted.find((e) => e.name === 'skill_ref');
    expect(skillRef).toBeDefined();

    const editor = new Editor({
      extensions: [Document, Paragraph, Text, Markdown.configure({ html: true, breaks: true }), skillRef!],
      content: '',
    });
    try {
      editor.commands.insertContent({ type: 'text', text: 'Please apply ' });
      const rows = await createSlashSession('chat-input').items('review');
      const picked = sourceRows(rows)[0]!.source!;
      await picked.source.onSelect(picked.item, editor);

      let node: { type: string; attrs: Record<string, unknown> } | null = null;
      editor.state.doc.descendants((n) => {
        if (n.type.name === 'skill_ref') node = { type: n.type.name, attrs: n.attrs };
      });
      expect(node).toEqual({ type: 'skill_ref', attrs: { slug: 'review-checklist' } });

      // What the composer submits (`ChatInputEditor.getMarkdown`, sent as the message text).
      const markdown = (editor.storage.markdown.getMarkdown() as string).trim();
      expect(markdown).toBe('Please apply <skill_ref slug="review-checklist"/>');
    } finally {
      editor.destroy();
    }
  });
});
