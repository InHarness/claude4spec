import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { SerializationContribution } from '../../serialization/types.js';
import { acSerializer } from './serializer.js';
import { acSystemPrompt } from './system-prompt.js';
import { createAcToolsServer } from './mcp-server.js';
import { acData, acSlugPattern } from '../../../shared/entities/ac/schema.js';

export const acBackendModule: BackendModule = {
  type: 'ac',
  data: acData,
  slugPattern: acSlugPattern,
  payloadVersion: 1,
  // Slug is slugified prose (ac: `text`, diagram: `caption`), so two entities
  // that start alike are two entities — suffix rather than refuse. See
  // `slugConflict` on the manifest; every identity-derived type takes the default.
  slugConflict: 'suffix',

  label: 'Acceptance Criterion',
  labelPlural: 'Acceptance Criteria',
  displayOrder: 50,
  pathPrefix: '/acs',
  serializer: acSerializer as SerializationContribution<unknown>,
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
   */
  backend: {
    mcpServer: (_service, ctx) =>
      createAcToolsServer({
        reader: ctx.reader,
        cwd: ctx.cwd,
        roots: ctx.roots,
        host: ctx.host,
      }),
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(acBackendModule);
}
