/**
 * M01 `7yzu5k8u` — the start-up check of `config.writingStyle` against the M37
 * skill registry (edge `m01-requires-m37`).
 *
 * An unresolvable writing style STOPS the start, and the message tells the two
 * causes apart, because they ask the user for two different actions:
 *
 * - `outside-registry` — the slug is not among the selectable styles: a typo, a
 *   style that does not exist, or the slug of a `contextual` skill (not a style,
 *   rejected like an unknown one);
 * - `envelope-not-loaded` — the slug is known to an envelope that did not load
 *   (gate-skipped package, or an entry the loader rejected): the carrier is
 *   missing, not the style.
 *
 * The third reason does NOT stop the start (2.1.9, M01 `7yzu5k8u`): a slug the
 * registry reports known but unresolved because the provider of a skill
 * attachment is unreachable (`provider-unreachable`, reported by the M52
 * `project-exposed` source) starts with a warning, and the style is treated as
 * absent — the resolver skips a slug the registry does not resolve, so no turn
 * gets a `<project_writing_skill/>` block until the provider resolves again.
 */

import type { SkillRegistry, SkillUnresolvedReason } from './skill-registry.js';

export type WritingStyleStartVerdict =
  | { ok: true; warning?: string }
  | { ok: false; reason: SkillUnresolvedReason; message: string };

export function checkWritingStyleAtStart(
  registry: Pick<SkillRegistry, 'isSelectable' | 'unresolvedReason' | 'unselectableReason'>,
  slug: string | null,
): WritingStyleStartVerdict {
  if (slug === null || registry.isSelectable(slug)) return { ok: true };
  // A slug the registry resolves but cannot select (a contextual skill) is
  // rejected exactly like an unknown one.
  const reason: SkillUnresolvedReason = registry.unresolvedReason(slug)?.reason ?? 'outside-registry';
  const lead = `config.json: writingStyle "${slug}"`;
  if (reason === 'provider-unreachable') {
    return {
      ok: true,
      warning: `${lead} ${registry.unselectableReason(slug)}. The project starts without a writing style.`,
    };
  }
  const message =
    reason === 'envelope-not-loaded'
      ? `${lead} cannot be resolved — its plugin package did not load. ${lead} ${registry.unselectableReason(slug)}.`
      : `${lead} is not a selectable writing style (a typo, or a style that does not exist) — ${lead} ${registry.unselectableReason(slug)}. Fix the slug in .claude4spec/config.json or set it to null.`;
  return { ok: false, reason, message };
}
