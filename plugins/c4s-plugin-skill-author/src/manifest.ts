import type { PluginManifest } from '@c4s/plugin-runtime';
import { skillAuthorSkill } from './skills/skill-author.js';

/**
 * A CAPABILITY-class, SINGLE-SLOT envelope (M13 registry of built-in envelopes,
 * `hevpbnsk`): zero `contributes.entities[]`, exactly one `contributes.skills[]`,
 * nothing else.
 *
 * The class test — could someone OUTSIDE the host repo want to write the same
 * thing and hand it to others? — passes: the methodology of writing project
 * skills is content, not host code. It reaches for no service, knows no entity
 * type, and is replaceable whole without touching anything outside itself.
 *
 * Separate from `c4s-plugin-writing-style-author` because the PRODUCT differs:
 * that one teaches writing a style for the specification; this one teaches
 * writing instructions for the agent — in the project's `skills` root, in a style
 * other than the specification's, through that root's write tool. Bundling the
 * two would make an installation that wants one workshop take the other.
 *
 * `contributes.entities: []` is written out rather than omitted: the emptiness is
 * the point of the package.
 *
 * "Built-in" means exactly: it ships inside the host package, so it loads with no
 * `trustProjectPlugins` gate, and its `hostApiVersion` agrees by construction.
 * Nothing binds it to the Host API beyond the SHAPE of its one contribution
 * (`skills[]` with `contextTypes`); no `backend`, no MCP server, no UI. No
 * `onUnregister`: the package holds no resource of its own — one
 * `registry.unregisterPlugin(name)` takes the skill off the listing of the next
 * turn, and `load_skill_file` on the slug then answers `SKILL_NOT_FOUND`.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-skill-author',
  version: '2.1.9',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [],
    skills: [skillAuthorSkill],
  },
};
