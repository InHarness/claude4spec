import type { PluginManifest } from '@c4s/plugin-runtime';
import { layeredVerticalSlicesStyle } from './skills/layered-vertical-slices.js';
import { layeredSpecExplore } from './subagents/layered-spec-explore.js';

/**
 * The first CAPABILITY-class envelope: a plugin that contributes no entity type
 * at all.
 *
 * Every other envelope in this repo travels together because its contributions
 * are COUPLED — `ui-view` declares a fixed ref at `design-system`, so splitting
 * the pair would cut the declaration. This one travels together for a different
 * reason: its two contributions are one authorial capability, writable and
 * distributable by someone outside the host repo. The test is "could a stranger
 * want to write this and give it to others?" — a writing style passes it; an
 * `endpoint`/`dto` pair does not.
 *
 * `contributes.entities: []` is written out rather than omitted. Every slot is
 * optional and the empty array and the omission are the same thing to the host,
 * but the emptiness is the POINT of this package and reads better said than
 * implied.
 *
 * Nothing binds this envelope to the Host API beyond the SHAPE of its two
 * contributions: no QueryClient, no EditorBridge, no host service, no UI
 * catalogue, no MCP server of its own, no `backend` slot anywhere. The body of
 * `SKILL.md`, the split of `workflows/` and the wording of `promptBody` are
 * internal and replaceable without touching `hostApiVersion`.
 *
 * Being BUILT-IN has exactly one consequence: it ships inside the host package
 * and therefore loads with no `trustProjectPlugins` gate, and its
 * `hostApiVersion` agrees by construction because host and envelope are built
 * together. That is what keeps the FLOOR invariant — at least one style
 * resolves in every installation, so `config.writingStyle:
 * "layered-vertical-slices"` never fails for want of a carrier. The invariant
 * stops being free the day this package moves to its own npm repo.
 *
 * No `onUnregister`: the package is purely declarative and holds no resource of
 * its own. One `registry.unregisterPlugin(name)` takes BOTH contributions off —
 * the style and the subagent — because both are pull-read off the record.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-layered-vertical-slices',
  version: '0.2.57',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [],
    writingStyles: [layeredVerticalSlicesStyle],
    subagents: [layeredSpecExplore],
  },
};
