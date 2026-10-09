import { useQuery } from '@tanstack/react-query';
import { skillsApi, type SkillListing } from '../lib/skills-api.js';

/**
 * M52 — the skill listing of the `chat` context type, as the browser reads it.
 * The `spec-skills` command source pulls it at every opening of the composer's
 * slash popover; `SkillRefChip` reads it through react-query to tell a live
 * slug from a gone one.
 */
export const CHAT_SKILL_CONTEXT = 'chat';

export const chatSkillListingKey = ['skills', 'listing', CHAT_SKILL_CONTEXT] as const;

export function fetchChatSkillListing(): Promise<SkillListing> {
  return skillsApi.listForContext(CHAT_SKILL_CONTEXT);
}

export function useChatSkillListing() {
  return useQuery({ queryKey: chatSkillListingKey, queryFn: fetchChatSkillListing, staleTime: 30_000 });
}
