import type { Editor } from '@tiptap/core';
import { registerSlashCommandSource, type SlashCommandSource, type SlashCommandSourceItem } from '../tiptap/registry.js';
import type { SkillListing } from '../lib/skills-api.js';
import { fetchChatSkillListing } from './chatSkillListing.js';

/**
 * M52 — Spec Skills, editor contribution (sheet `wklad-do-edytora-m52`, row
 * `spec-skills`): a COMMAND SOURCE in the chat composer (`chat-input`),
 * registered directly from the module's front-end bootstrap.
 *
 *  - Items come from the skill listing of the `chat` context type, read at
 *    every opening of the popover (the slash framework pulls, nothing here
 *    caches): each skill → `/<slug>` with `id` = slug, `description`, `hint` =
 *    slug, and its listing `origin` as the origin marker.
 *  - A fixed entry `/skills` narrows the same popover to this source's items.
 *    In that narrowed view the collision rule removes nothing, so a skill whose
 *    slug equals a built-in command (`/section`) stays reachable there.
 *  - Picking a skill inserts `<skill_ref slug="…"/>` at the caret, one
 *    transaction; the built-in command wins a collision in the full view
 *    (the framework's `hint` rule, M20 `lxdrxdm2`).
 */
export const SPEC_SKILLS_SOURCE_ID = 'spec-skills';

/** Id of the `/skills` entry — not a slug shape, so it never collides with a skill's `id`. */
export const SKILLS_NARROW_ENTRY_ID = ':skills';

export interface SpecSkillItem extends SlashCommandSourceItem {
  /** The skill's slug; absent on the `/skills` entry. */
  slug?: string;
}

/** The `/skills` entry: picking it narrows the popover to this source. */
export const SKILLS_NARROW_ENTRY: SpecSkillItem = {
  id: SKILLS_NARROW_ENTRY_ID,
  label: '/skills',
  description: 'Show spec skills only',
  hint: 'skills',
  narrowTo: SPEC_SKILLS_SOURCE_ID,
};

/** The source's items for one listing: the `/skills` entry, then one `/<slug>` per skill. */
export function specSkillItems(listing: SkillListing | null | undefined): SpecSkillItem[] {
  const rows = listing?.listing ?? [];
  const seen = new Set<string>();
  const items: SpecSkillItem[] = [SKILLS_NARROW_ENTRY];
  for (const row of rows) {
    if (!row?.slug || seen.has(row.slug)) continue;
    seen.add(row.slug);
    items.push({
      id: row.slug,
      // ASSUMPTION:dev-0901 — the `chat` listing carries no title, so the
      // label is the visible trigger `/<slug>` instead of the skill's title.
      label: `/${row.slug}`,
      description: row.description ?? '',
      hint: row.slug,
      origin: row.origin,
      slug: row.slug,
    });
  }
  return items;
}

/** Insert `<skill_ref slug="…"/>` (and a separating space) at the caret, in one transaction. */
export function insertSkillRef(editor: Editor, slug: string): boolean {
  return editor
    .chain()
    .focus()
    .insertContent([
      { type: 'skill_ref', attrs: { slug } },
      { type: 'text', text: ' ' },
    ])
    .run();
}

export function createSpecSkillsSource(
  readListing: () => Promise<SkillListing> = fetchChatSkillListing,
): SlashCommandSource<SpecSkillItem> {
  return {
    id: SPEC_SKILLS_SOURCE_ID,
    context: 'chat-input',
    list: async () => specSkillItems(await readListing()),
    onSelect: (item, editor) => {
      if (item.slug) insertSkillRef(editor, item.slug);
    },
  };
}

registerSlashCommandSource(createSpecSkillsSource());
