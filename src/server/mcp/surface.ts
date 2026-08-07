/**
 * The external MCP surface — one server, composed in memory under a context
 * profile.
 *
 * ## Why this file exists
 *
 * Until 0.2.12 the external surface was a separate PROCESS (`c4s-mcp`) with its
 * own read-only SQLite handle, its own plugin loader and its own idea of which
 * fourteen operations existed. Everything it could answer, the server process
 * could also answer — differently, from different code, drifting on its own
 * schedule. 0.2.13 keeps one execution locus (the server process) and makes the
 * channel an adapter, so this module composes the surface out of the SAME
 * builders the internal turn uses at `routes/agent-turn.ts`.
 *
 * ## One mount is one server
 *
 * MCP gives a connection a single flat tool namespace, while the internal
 * channel mounts eight-plus NAMED servers. So the servers are merged and the
 * tool names deduplicated. Collisions are expected rather than exceptional:
 * `find_references` is on both `c4s-reader` and `reference-tools`, `get_entities`
 * on both `c4s-reader` and `entity-tools`. They are two renderings of ONE catalog
 * operation, which is the whole premise of the release — so first-wins is not a
 * tie-break, it is the catalog collapsing back to one row per operation.
 *
 * `c4s-reader` is ordered first deliberately: its fourteen tools are the M39
 * discovery core rendered with no service layer in between, which is the
 * definition the catalog names as the owner.
 *
 * ## The name stays `c4s-reader`, and it is misleading
 *
 * Recorded so nobody "fixes" it: the external surface is NO LONGER READ-ONLY.
 * The `readonly: true` db handle that used to guarantee that is gone — this
 * surface shares the server's writable handle like everything else in the
 * process. Read-only is now a property of the M39 core BY CONSTRUCTION (it
 * exposes no mutating operation) plus the profile gate, which the catalog only
 * ever narrows and never widens. A server's name is not a statement about the
 * permissions of a connection.
 */

import type { ChatContextType } from '../../shared/entities.js';
import type { McpToolDeclaration } from '../../shared/plugin-host/mcp.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { createMcpServer, type CapturedMcpServer } from '../plugin-runtime/index.js';
import type { McpToolDefinition } from '@inharness-ai/agent-adapters';
import { gateServer, pluginServerNamesFor } from '../operations/profile-gate.js';
import { BRIEF_ALLOWED_PLUGIN_MCP, mcpServerSetForProfile } from '../operations/profiles.js';
import { createC4sReaderServer, type C4sReaderDeps } from './c4s-reader.js';
import { buildPlanToolsServer } from './plan-tools.js';
import { buildBriefToolsServer } from './brief-tools.js';
import { buildC4sToolsServer } from './c4s-tools.js';
import { buildWorkspaceToolsServer } from './workspace-tools.js';
import type { BriefService } from '../services/brief.js';
import type { PlanService } from '../services/plan.js';
import type { FileVersionService } from '../services/file-version.js';
import type { ListProjectsResult } from '../workspace/list-projects.js';

export interface ExternalSurfaceDeps {
  /** Fixed when the connection is established; immutable for its whole life. */
  profile: ChatContextType;
  /** The M39 read backbone, already bound to the resolved project. */
  reader: C4sReaderDeps;
  pluginHost: ProjectPluginHost;
  planService: PlanService;
  pageVersions: FileVersionService;
  briefService: BriefService;
  /** M31 `list_projects`. A thunk — the registry is re-read per call. */
  listProjects: () => ListProjectsResult;
  /** The caller's workspace, so `ask` defaults to it. */
  workspaceName: string;
}

/** The composed server's name — see the header note before changing it. */
export const EXTERNAL_MCP_SERVER_NAME = 'c4s-reader';

/**
 * The named servers this profile contributes, BEFORE the per-tool gate.
 *
 * Coarse selection only: which servers exist at all on this channel. The fine
 * gate (which TOOLS survive within them) is `gateServer`, applied below — the
 * same two-stage shape the turn dispatcher uses, for the same reason. The coarse
 * layer cannot express "this profile gets `get_page` but not `create_tag`",
 * because both live on `reference-tools`.
 */
function sourceServers(deps: ExternalSurfaceDeps): Array<{ name: string; server: CapturedMcpServer }> {
  // The coarse, server-level view DERIVED from the profile's operation classes —
  // the same one the turn dispatcher reads, so the two channels cannot select
  // different servers for the same profile.
  const set = mcpServerSetForProfile(deps.profile);
  const servers: Array<{ name: string; server: CapturedMcpServer }> = [
    { name: EXTERNAL_MCP_SERVER_NAME, server: createC4sReaderServer(deps.reader) },
  ];

  for (const entry of deps.pluginHost.buildMcpServers()) {
    if (set.pluginServers === 'release-only' && !BRIEF_ALLOWED_PLUGIN_MCP.has(entry.name)) continue;
    // `buildMcpServers()` returns the host-owned `McpServerFactory` view. Every
    // in-repo and plugin server is built through the facade, so `.tools` is
    // present; a handle without it contributes nothing to enumerate and is
    // dropped by the merge below rather than mounted blind.
    servers.push({ name: entry.name, server: entry.server as CapturedMcpServer });
  }

  if (set.planTools) {
    servers.push({
      name: 'plan-tools',
      /**
       * `threadId` is the plan tools' provenance stamp for versions they write,
       * not an addressing parameter — there is no thread on this channel, so the
       * connection says so rather than borrowing an unrelated id.
       */
      server: buildPlanToolsServer({
        threadId: 'mcp-external',
        planService: deps.planService,
        pageVersions: deps.pageVersions,
      }),
    });
  }

  if (set.briefTools) {
    servers.push({
      name: 'brief-tools',
      // Explicit mode: no thread, so every call names its brief. See
      // `requiresExplicitBriefTarget` in `operations/profiles.ts`.
      server: buildBriefToolsServer({ briefService: deps.briefService, target: 'explicit' }),
    });
  }

  if (set.c4sTools) {
    servers.push({ name: 'c4s-tools', server: buildC4sToolsServer(deps.workspaceName) });
  }

  /**
   * Unconditional, exactly as in the internal channel: `list_projects` is a
   * read-class operation every profile admits, and both alternative homes carry
   * a gate that has nothing to do with it.
   */
  servers.push({ name: 'workspace-tools', server: buildWorkspaceToolsServer(deps.listProjects) });

  /**
   * `transagent-tools` is absent BY CONSTRUCTION, not by policy — do not "add
   * it for parity". Its dispatcher recurses into `runAgentTurn` and needs
   * `AgentTurnDeps` plus a live parent thread to do so. An external connection
   * is explicitly not a turn and has neither, so there is nothing to build.
   */

  return servers;
}

export interface ExternalSurface {
  /** Merged, gated, deduplicated — in declaration order. */
  tools: readonly McpToolDeclaration[];
  byName: ReadonlyMap<string, McpToolDeclaration>;
  /** Sorted tool names — the fingerprint `tools/list_changed` is decided on. */
  toolNames: readonly string[];
}

/**
 * Compose the surface as DECLARATIONS rather than as a connected server.
 *
 * The mount needs the two halves separately. Tool identity (name, description,
 * schema) is what a session advertises and must stay stable across a rebuild;
 * the handler is what has to be re-resolved, because it closes over services
 * belonging to one `ProjectContext` and that context can be evicted underneath
 * an open connection. Returning a built server would have fused the two and made
 * "the context is rebuilt lazily at `tools/call`" impossible to honour.
 */
export function composeExternalSurface(deps: ExternalSurfaceDeps): ExternalSurface {
  const pluginServers = pluginServerNamesFor(deps.pluginHost.listEntities().map((m) => m.type));

  const tools: McpToolDeclaration[] = [];
  const byName = new Map<string, McpToolDeclaration>();
  for (const { name, server } of sourceServers(deps)) {
    // The per-tool profile gate, identical to the turn's — including the
    // fail-closed rule for a plugin's own server, which must hold on this
    // channel too: an external `ask` connection reaching `spreadsheet-tools`'
    // six mutating operations is the exact hole the gate was built to close.
    const gated = gateServer(deps.profile, name, server, pluginServers);
    if (!gated?.tools) continue;
    for (const tool of gated.tools) {
      if (byName.has(tool.name)) continue;
      byName.set(tool.name, tool);
      tools.push(tool);
    }
  }

  return { tools, byName, toolNames: [...byName.keys()].sort() };
}

/**
 * The same surface as one connectable server. Used by the stdio-era code paths
 * and by tests that want a handle rather than declarations; the HTTP mount does
 * NOT use this, for the reason in `composeExternalSurface`'s note.
 */
export function buildExternalMcpSurface(deps: ExternalSurfaceDeps): CapturedMcpServer {
  return createMcpServer({
    name: EXTERNAL_MCP_SERVER_NAME,
    tools: composeExternalSurface(deps).tools as unknown as McpToolDefinition[],
  });
}
