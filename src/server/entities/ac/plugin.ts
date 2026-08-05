import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { SerializationContribution } from '../../serialization/types.js';
import { acSerializer } from './serializer.js';
import { acSystemPrompt } from './system-prompt.js';
import { AcService } from './service.js';
import { createAcToolsServer } from './mcp-server.js';
import { acData, acSlugPattern } from '../../../shared/entities/ac/schema.js';

export const acBackendModule: BackendModule = {
  type: 'ac',
  data: acData,
  slugPattern: acSlugPattern,
  payloadVersion: 1,
  label: 'Acceptance Criterion',
  labelPlural: 'Acceptance Criteria',
  displayOrder: 50,
  pathPrefix: '/acs',
  serializer: acSerializer as SerializationContribution<unknown>,
  systemPrompt: acSystemPrompt,
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router, mount the custom MCP
  // server for ac's semantic-audit tool.
  backend: {
    // 2.0.0: the hand-written `onEntityRenamed` that rewrote `verifies[].slug`
    // is gone. `ref: '$type'` on that field says the same thing declaratively,
    // and `db/ref-rewrite.ts` acts on it for every type at once.
    service: (ctx) => new AcService(ctx.db, ctx.tagsService, ctx.versionService, ctx.host, ctx.entityStore),
    mcpServer: (service, ctx) =>
      createAcToolsServer({
        acService: service as AcService,
        db: ctx.db,
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
