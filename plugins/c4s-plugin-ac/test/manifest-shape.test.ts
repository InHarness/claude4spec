/**
 * The envelope's two invariants, pinned where they can be read together.
 *
 * ── `hostApiVersion` ──
 *
 * `'^1.0.0'` is what this manifest carried right up to the move, and a stale
 * range here does NOT fail loudly. The loader's semver gate `continue`s BEFORE
 * `registerPlugin`, so the whole type is simply absent — no sidebar tab, no
 * `/acs` routes, no serializer, no `ac-tools`, no `ac-audit` — with one
 * `PLUGIN_HOST_API_MISMATCH` line in the log as the only evidence, while the
 * entity files sit on disk with nothing able to read them. That happened once
 * already, to `database-table`, and went unnoticed for two releases. It is the
 * single most load-bearing character in this package.
 *
 * ── The unit of distribution ──
 *
 * `ac` and `ac-audit` ship together, and the assertion is that BOTH slots are
 * filled by this one manifest. The subagent reads acceptance criteria and
 * nothing else, so in a project with no active `ac` type it has no subject
 * matter; splitting it into an envelope of its own would let it outlive the type
 * it exists to audit, which is the same failure the `ui-view-mockup-generator`
 * skill would have had.
 *
 * Note which rule that is NOT. `ui-view` and `design-system` are paired by a
 * fixed single-target `ref`, which must resolve from the first registration.
 * `ac.verifies[]` is polymorphic — `{type, slug}[]` aimed at any active type —
 * so it binds no particular type, and applying the ref rule here would force one
 * envelope for everything. The `dependsOn` assertion below is what keeps that
 * distinction honest.
 */

import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { acEntity } from '../src/entity/ac/index.js';
import { acAuditSubagent } from '../src/subagents/ac-audit.js';

describe('c4s-plugin-ac manifest', () => {
  it('declares compatibility with the 2.0.0 host API', () => {
    expect(manifest.hostApiVersion).toBe('^2.0.0');
  });

  it('is named for the package the loader discovers it in', () => {
    expect(manifest.name).toBe('c4s-plugin-ac');
  });

  it('contributes exactly one entity type: ac', () => {
    expect(manifest.contributes?.entities?.map((e) => e.type)).toEqual(['ac']);
    expect(manifest.contributes?.entities?.[0]).toBe(acEntity);
  });

  it('contributes exactly one subagent, in the same envelope: ac-audit', () => {
    expect(manifest.contributes?.subagents?.map((s) => s.name)).toEqual(['ac-audit']);
    expect(manifest.contributes?.subagents?.[0]).toBe(acAuditSubagent);
  });

  /**
   * A polymorphic ref binds nothing, so nothing is declared. A `dependsOn` here
   * would be a claim that some OTHER type must register first — which for
   * `verifies[]` is not true of any one type, and asserting it would make the
   * envelope refuse to load in a project that happens not to have it.
   */
  it('declares no dependsOn — verifies[] is polymorphic', () => {
    expect((acEntity as { dependsOn?: unknown }).dependsOn).toBeUndefined();
  });

  /**
   * Teardown is the HOST's: `unregisterPlugin` fans out over `contributedTypes`
   * and every consumer pull-reads. The slot exists for a plugin's OWN resources
   * — a timer, a watcher, an open connection — and this package holds none.
   * Declaring one would duplicate the host's work.
   */
  it('declares no onUnregister', () => {
    expect((manifest as { onUnregister?: unknown }).onUnregister).toBeUndefined();
  });

  /** The two halves of one type must not disagree about their own payload age. */
  it('backend and frontend agree on payloadVersion', async () => {
    const { acFrontendModule } = await import('../src/entity/ac/frontend/module.js');
    expect(acEntity.payloadVersion).toBe(3);
    expect(acFrontendModule.payloadVersion).toBe(acEntity.payloadVersion);
  });
});
