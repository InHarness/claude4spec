import { SkillRefChip, type SkillRefChipState } from '../../skills/SkillRefChip.js';
import { useChatSkillListing } from '../../skills/chatSkillListing.js';
import type { SkillListing } from '../../lib/skills-api.js';
import { assignTagRender, type TagRenderProps } from '../renders.js';

/**
 * M52 — Spec Skills, browser side: `SkillRefChip` as the render of
 * `<skill_ref slug/>` (sheet `znaczniki-xml-m52`). Validation from project
 * state: the slug is compared with the `chat` skill listing in the browser; a
 * slug outside it is the broken state. The page editor's node view and the
 * chat (composer and history, user and assistant) read this same render.
 */
export function skillRefState(slug: string, listing: SkillListing | undefined): SkillRefChipState {
  if (!slug) return 'broken';
  if (!listing) return 'loading';
  return listing.listing.some((row) => row.slug === slug) ? 'normal' : 'broken';
}

export function SkillRefRender({ attrs }: TagRenderProps) {
  const slug = String(attrs.slug ?? '');
  const { data, isError } = useChatSkillListing();
  // A listing that cannot be read says nothing about the slug: stay neutral.
  const state = isError ? 'loading' : skillRefState(slug, data);
  const row = data?.listing.find((r) => r.slug === slug);
  return <SkillRefChip slug={slug} state={state} origin={row?.origin} description={row?.description} />;
}

assignTagRender('skill_ref', SkillRefRender);
