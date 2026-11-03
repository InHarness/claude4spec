/**
 * The `skill.name` syntax (M52): kebab-case — lowercase letters, digits and
 * single hyphens. One definition for the settings field and for the names
 * `c4s confirm-skill-uses` confirms (M31, 2.1.67). Kept dependency-free so the
 * server-free CLI path does not load the settings registry.
 */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
