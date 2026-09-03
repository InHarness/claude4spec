import type { MountContext, PluginRegistry } from '../../core/plugin-host/types.js';
import type { EntityContribution, PluginManifest } from '../../../shared/plugin-host/manifest.js';
import { acSerialization } from './serializer.js';
import { acSystemPrompt } from './system-prompt.js';
import { createAcToolsServer } from './mcp-server.js';
import { acAuditSubagent } from './subagents/ac-audit.js';
import { acData, acSlugPattern } from '../../../shared/entities/ac/schema.js';

export const acBackendModule: EntityContribution = {
  type: 'ac',
  data: acData,
  slugPattern: acSlugPattern,
  payloadVersion: 3,
  // Slug is slugified prose, so two entities that start alike are two entities —
  // suffix rather than refuse. See `slugConflict` on the manifest. `diagram`
  // left this group in 0.2.22: a repeated diagram TITLE is now a hard conflict,
  // because two diagrams meant to be one is a worse outcome than a refusal. An
  // AC is different — two criteria opening with the same clause are ordinary.
  slugConflict: 'suffix',

  label: 'Acceptance Criterion',
  labelPlural: 'Acceptance Criteria',
  displayOrder: 50,
  pathPrefix: '/acs',
  ...acSerialization,
  systemPrompt: acSystemPrompt,
  /**
   * 2.0.0 tier K (item 61) — `mcpServer` only, and no `service` behind it.
   *
   * `AcService` is deleted. Of everything it held, exactly two things were not
   * CRUD: `classifyVerifies`, lifted to `./classify-verifies.ts` in K2 and now
   * feeding the `single_element`/`detail` views, and the `status = 'active'`
   * default, which is `systemPrompt.defaultPredicate` and applies to every
   * transport at once. The semantic audit below is a READER, so it takes the
   * reader; `ref: '$type'` on `verifies[].slug` repoints it after a rename.
   *
   * The server stays ONE-TOOL. `find_ac_conflicts` was considered and rejected:
   * AC↔AC comparison is quadratic and the narrowing that makes it affordable is
   * a judgement, not a filter over a schema field. That gap closes with the
   * `ac-audit` subagent below instead.
   */
  backend: {
    mcpServer: (_service: unknown, ctx: MountContext) =>
      createAcToolsServer({
        reader: ctx.reader,
        cwd: ctx.cwd,
        roots: ctx.roots,
        host: ctx.host,
        discovery: ctx.discovery,
      }),
  },
};

/**
 * 0.2.58 — the envelope stops being a carrier of ONE kind of contribution.
 *
 * `ac` is still a tier-(a) type registered in-process rather than a package under
 * `plugins/` (the specification says so itself: "Pakiet nie istnieje jeszcze w kodzie —
 * opis wyprzedza implementację"), but the SHAPE of its registration is now the envelope's:
 * a manifest with two slots. That is not cosmetic — `registerEntityModule` knows only the
 * entity slot, and `registry.registerPlugin` is the only fan-out that reaches
 * `contributes.subagents`, which `subagentsFor()` then pull-reads per turn.
 *
 * `hostApiVersion` is carried as the specification writes it. It gates nothing on this
 * path — the semver gate is the M33 loader's, and this is a direct in-process call — but
 * it would gate the day this envelope actually moves under `plugins/`. Filed as a
 * clarification patch against brief 0-2-57-to-0-2-58 rather than silently corrected here.
 */
export const acPlugin: PluginManifest = {
  name: 'c4s-plugin-ac',
  version: '1.0.0',
  hostApiVersion: '^1.0.0',
  contributes: { entities: [acBackendModule], subagents: [acAuditSubagent] },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerPlugin(acPlugin);
}
