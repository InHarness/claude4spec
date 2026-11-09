/**
 * The `skill.name` syntax (M52): kebab-case — lowercase letters, digits and
 * single hyphens. One rule for the server (the settings field, the names
 * `c4s confirm-skill-uses` confirms — M31) and the browser (the onboarding
 * type steps' live validation — M59/M60). Dependency-free.
 */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
