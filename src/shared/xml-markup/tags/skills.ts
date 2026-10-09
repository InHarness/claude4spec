import { registerXmlTag } from '../registry.js';

/**
 * M52 — Spec Skills: `<skill_ref slug="…"/>` (2.1.9, sheet `znaczniki-xml-m52`).
 * One attribute, `slug` — the slug of a skill-registry entry, not an entity or
 * a section, so there is no `type`. Inline. Registered WITHOUT `validate`:
 * whether a slug exists depends on one project's skill registry, which a
 * closure here would leak across projects. The chip (`SkillRefChip`) checks it
 * in the browser against the `chat` listing; the agent's `load_skill_file`
 * answers `SKILL_NOT_FOUND` for one that is gone. A package renamed outside C4S
 * gets a new slug and nothing rewrites the chips that named the old one.
 */
registerXmlTag({ name: 'skill_ref', attrOrder: ['slug'], form: 'inline' });
