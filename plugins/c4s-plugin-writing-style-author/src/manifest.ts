import type { PluginManifest } from '@c4s/plugin-runtime';
import { writingStyleAuthorSkill } from './skills/writing-style-author.js';

/**
 * The second CAPABILITY-class envelope, and the first SINGLE-SLOT one: zero
 * `contributes.entities[]`, exactly one `contributes.skills[]`, nothing else.
 *
 * Splitting it from `c4s-plugin-layered-vertical-slices` is deliberate rather than
 * incidental. That envelope travels as one package because its contributions are
 * one capability — a style plus the two subagents that know it. This skill is
 * STYLE-AGNOSTIC: it teaches how to author any writing style, and
 * `layered-vertical-slices` is merely one of its outputs. Packaging the two
 * together would couple a tool to one of the things it makes, and would tell a
 * user who wants to write their own conventions that they must first install
 * somebody else's.
 *
 * `contributes.entities: []` is written out rather than omitted. The empty array
 * and the omission are the same thing to the host, but the emptiness is the POINT
 * of this package and reads better said than implied.
 *
 * Note which invariant this envelope guards, because it is easy to confuse with
 * its sibling's. The FLOOR invariant protects SERVER START — `config.writingStyle`
 * must always resolve to something — and belongs to the reference-style envelope.
 * This one protects the user's ESCAPE ROUTE: the person for whom no available
 * style fits and who has to be able to write their own. Losing this package costs
 * nobody a boot; it costs somebody a way out.
 *
 * Being BUILT-IN has exactly one consequence: it ships inside the host package and
 * therefore loads with no `trustProjectPlugins` gate, and its `hostApiVersion`
 * agrees by construction because host and envelope are built together.
 *
 * Nothing binds it to the Host API beyond the SHAPE of its one contribution: no
 * `backend` slot, no `@c4s/plugin-runtime` runtime dependency, no MCP server, no
 * UI. The body of `SKILL.md` is internal and replaceable without touching
 * `hostApiVersion`.
 *
 * No `onUnregister`: the package is purely declarative and holds no resource of its
 * own. One `registry.unregisterPlugin(name)` takes the skill off, after which
 * `resolveForContext` returns it in no context and `load_skill_file` on the slug
 * answers `SKILL_NOT_FOUND`. It leaves `config.writingStyle` alone — the author is
 * not itself a style, so there is nothing for config validation to re-check.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-writing-style-author',
  version: '0.2.66',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [],
    skills: [writingStyleAuthorSkill],
  },
};
