/**
 * The `skill.name` syntax (M52) lives in src/shared/skill-name.ts — one rule for
 * the settings field, for the names `c4s confirm-skill-uses` confirms (M31,
 * 2.1.67) and for the onboarding type steps in the browser. Kept
 * dependency-free so the server-free CLI path does not load the settings registry.
 */
import { SKILL_NAME_RE } from '../../shared/skill-name.js';

export { SKILL_NAME_RE };

/**
 * 2.1.69 (M31 `naxqsfra`, M52 `wqvq1esb`): the names of a list that are not in
 * the `skill.name` syntax, in the order given — empty when every one is.
 */
export function invalidSkillNames(names: readonly string[]): string[] {
  return names.filter((n) => typeof n !== 'string' || !SKILL_NAME_RE.test(n));
}

/**
 * 2.1.69 (M31 `naxqsfra`): thrown by the core `setSkillUsesConfirmation` when a
 * name of the list is outside the `skill.name` syntax — the whole write is
 * refused before anything reaches the registry. Each channel reports it with its
 * own bad-argument code (`INVALID_ARGUMENT` on REST, `INVALID_ARGS` in the CLI).
 */
export class SkillNameSyntaxError extends Error {
  constructor(readonly names: string[]) {
    super(
      `not a skill.name (kebab-case: lowercase letters, digits and single hyphens): ${names.map((n) => `'${n}'`).join(', ')}`,
    );
    this.name = 'SkillNameSyntaxError';
  }
}
