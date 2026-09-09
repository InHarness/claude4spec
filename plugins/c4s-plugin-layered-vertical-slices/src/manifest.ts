import type { PluginManifest } from '@c4s/plugin-runtime';
import { moduleDependencyEntity } from './entity/module-dependency/index.js';
import { layeredVerticalSlicesStyle } from './skills/layered-vertical-slices.js';
import { layeredSpecExplore } from './subagents/layered-spec-explore.js';
import { layeredSpecReview } from './subagents/layered-spec-review.js';

/**
 * 0.2.70 — this envelope stops being a CAPABILITY and becomes a COUPLING.
 *
 * Until now it was the first envelope in the repo with `entities: []`, and it
 * travelled as one package for a reason no other envelope used: its
 * contributions were one authorial capability, writable and distributable by
 * someone outside the host repo. The test was "could a stranger want to write
 * this and give it to others?" — a writing style passes it, an `endpoint`/`dto`
 * pair does not.
 *
 * It now travels together for the ORDINARY reason instead, the same one that
 * binds `ui-view` to `design-system`: the contributions declare each other.
 * `SKILL.md` mandates that a module→module relation is recorded as a
 * `module-dependency` entity — by slug, and UNCONDITIONALLY, not as a clause
 * conditional on the type being present. It can only afford to say that because
 * the type rides in this same manifest and comes off the registry with the same
 * `unregisterPlugin` call. Split them into two envelopes and the type could be
 * detached, leaving a style that mandates writing into an entity type that does
 * not exist.
 *
 * So the argument for one package is now HARD rather than editorial, and the
 * three slots are one unit:
 *
 *   - `entities[]`     — `module-dependency`, one directed edge per ordered pair;
 *   - `writingStyles[]`— `layered-vertical-slices`, which mandates that form;
 *   - `subagents[]`    — an explorer of the specification and a reviewer of the
 *                        saved change, neither of which knows what a module or a
 *                        layer is without the style.
 *
 * What binds it to the Host API grows with that. It was the SHAPE of two
 * contributions and nothing else; it is now the shape of three, plus the UI Kit
 * catalogue, since the type's three render slots are composed from it. Still no
 * QueryClient, no EditorBridge, no host service, no MCP server, no `backend`
 * slot anywhere. Worth naming precisely: of the kit components used here only
 * `FieldRow` and `FieldGrid` are in `UI_KIT_STABLE_COMPONENTS` — `EntityListRow`,
 * `Badge` and `LoadingState` are experimental, so this new binding is only
 * partly covered by `hostApiVersion`. The version itself does not move: the host
 * API did not change, only how much of it this package touches.
 *
 * Being BUILT-IN has exactly one consequence: it ships inside the host package
 * and therefore loads with no `trustProjectPlugins` gate, and its
 * `hostApiVersion` agrees by construction because host and envelope are built
 * together. That is what keeps the FLOOR invariant — at least one style resolves
 * in every installation, so `config.writingStyle: "layered-vertical-slices"`
 * never fails for want of a carrier. The invariant stops being free the day this
 * package moves to its own npm repo.
 *
 * No `onUnregister`: the package is purely declarative and holds no resource of
 * its own. One `registry.unregisterPlugin(name)` takes EVERY contribution off —
 * the type, the style and both subagents — because all of them are pull-read off
 * the record.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-layered-vertical-slices',
  version: '0.2.73',
  hostApiVersion: '^2.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [moduleDependencyEntity],
    writingStyles: [layeredVerticalSlicesStyle],
    subagents: [layeredSpecExplore, layeredSpecReview],
  },
};
