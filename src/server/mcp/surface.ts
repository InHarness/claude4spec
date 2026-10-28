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
 * `c4s-reader` is ordered first deliberately: its fifteen tools are the M39
 * discovery core rendered with no service layer in between, which is the
 * definition the catalog names as the owner. So the core reads — `get_entities`,
 * `get_field_content`, `find_references`, … — are issued by the `c4s-reader`
 * declaration, never by their internal counterparts (M12 `m12mcp00`). A
 * rendering under a DIFFERENT name is not shadowed: `entity-tools`'
 * `describe_entity_type` stands beside `c4s-reader`'s `describe_types`, two
 * renderings of the one operation `describe_types`.
 *
 * No source server's name reaches the client: tools go out unprefixed, under the
 * one server name `c4s-reader`. The `mcp__c4s-reader__<tool>` prefix a model
 * sees comes from the KEY of the client's config entry (`MCP_CONFIG_SERVER_KEY`
 * in `mcp-config.ts`), not from the handshake.
 *
 * Content-bearing fields are read through `c4s-reader`'s own `get_field_content`
 * (M12 `4cli19xs`) — a rendering of the catalog operation, not a tool generated
 * per type.
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

import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import type { ChatContextType } from '../../shared/entities.js';
import type { McpToolDeclaration } from '../../shared/plugin-host/mcp.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { createMcpServer, type CapturedMcpServer } from '../plugin-runtime/index.js';
import type { McpToolDefinition } from '@inharness-ai/agent-adapters';
import { gateServer, pluginServerNamesFor } from '../operations/profile-gate.js';
import { CATALOG, type OperationScope } from '../operations/catalog.js';
import { toolError } from '../operations/envelope.js';
import { mcpRenderingProfile, mcpServerSetForProfile } from '../operations/profiles.js';
import { poolSelector } from '../services/turn-mcp-servers.js';
import { createC4sReaderServer, type C4sReaderDeps } from './c4s-reader.js';
import { buildPlanToolsServer } from './plan-tools.js';
import { buildBriefToolsServer } from './brief-tools.js';
import { buildC4sToolsServer } from './c4s-tools.js';
import { buildWorkspaceToolsServer } from './workspace-tools.js';
import { buildSkillToolsServer } from './skill-tools.js';
import type { SkillRegistry, SkillResolver } from '../services/skill-registry.js';
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
  /** M37 `load_skill_file` — the live registry (precedence winner per slug). */
  skillRegistry: SkillRegistry;
  /** M37 `list_skills` — the per-context-type resolver. */
  skillResolver: SkillResolver;
  /**
   * The resolved project, stamped onto the response-size telemetry record so
   * the process-level measurement ring is keyed rather than ambient.
   */
  projectId: string;
}

/** The composed server's name — see the header note before changing it. */
export const EXTERNAL_MCP_SERVER_NAME = 'c4s-reader';

/**
 * The error codes this surface can produce, declared rather than discovered.
 *
 * 0.2.13 changed the set, and the changes follow from the move rather than from
 * taste:
 *
 * **Arrived.** `PROJECT_NOT_IN_WORKSPACE` and `PROJECT_BUILD_FAILED`. Both are
 * produced by `projectDispatchMiddleware`, which the mount now sits behind —
 * they were already reachable, just undeclared, which is the state this list
 * exists to end.
 *
 * **Left.** `AMBIGUOUS_WORKSPACE`, `INDEX_NOT_MATERIALIZED` and
 * `SCHEMA_OUT_OF_DATE`. All three described the internal state of a SEPARATE
 * process holding its own handle on a db slot: which workspace it resolved,
 * whether that slot had been materialized, whether it had been migrated. There
 * is no such process any more. A caller who used to get `INDEX_NOT_MATERIALIZED`
 * — meaning "nothing has served this project yet" — now gets `SERVER_NOT_RUNNING`
 * from the bridge, which is the same fact stated where it is actionable.
 *
 * Everything else is the discovery core's own taxonomy, re-framed by the
 * transport and never re-invented (`DiscoveryErrorCode`).
 */
export const EXTERNAL_MCP_ERROR_CODES: readonly string[] = [
  'PROJECT_NOT_FOUND',
  'PROJECT_NOT_IN_WORKSPACE',
  'PROJECT_BUILD_FAILED',
  'VALIDATION',
  'NOT_FOUND',
  /**
   * 0.2.77 — arrives, and deliberately so, one list above the sibling this
   * surface RETIRED.
   *
   * `INDEX_NOT_MATERIALIZED` left because it described the internal state of a
   * separate process the caller could do nothing about. `INDEX_STALE` is the
   * opposite: it is actionable (rebuild the projection, retry the identical
   * call), and suppressing it would mean answering an external agent with
   * coordinates from a projection that is known not to match the files. That is
   * precisely the corruption the fail-closed rule exists to refuse, so the code
   * has to be able to reach this channel too.
   */
  'INDEX_STALE',
  /**
   * 0.2.99 — the M37 skills registry's taxonomy, identical to the one the other
   * three channels answer with (`services/skill-operations.ts`).
   */
  'INVALID_ARGUMENT',
  'SKILL_NOT_FOUND',
  'SKILL_FILE_NOT_FOUND',
  'NOT_TEXT',
  'INTERNAL',
];

/** Codes 0.2.13 removed from this surface — asserted absent, so they cannot creep back. */
export const RETIRED_EXTERNAL_MCP_ERROR_CODES: readonly string[] = [
  'AMBIGUOUS_WORKSPACE',
  'INDEX_NOT_MATERIALIZED',
  'SCHEMA_OUT_OF_DATE',
];

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
  // different servers for the same profile. Read for the profile this channel
  // RENDERS (`patch` → `chat`, M12 `ecawzsbr`).
  const set = mcpServerSetForProfile(mcpRenderingProfile(deps.profile));
  const servers: Array<{ name: string; server: CapturedMcpServer }> = [
    { name: EXTERNAL_MCP_SERVER_NAME, server: createC4sReaderServer(deps.reader) },
  ];

  /**
   * ORDER MATTERS, and every host-owned server is pushed before any plugin one.
   *
   * The merge is first-wins, so whoever declares a name first owns it on this
   * flat namespace. Plugin servers used to be pushed before plan/brief/c4s/
   * workspace-tools, which meant a plugin shipping a tool called `list_projects`
   * or `update_brief` took the name and an external caller asking for the host
   * operation got the plugin's handler instead. The host's own surface is the
   * one this repo can vouch for, so it wins every collision.
   */
  if (set.planTools) {
    servers.push({
      name: 'plan-tools',
      /**
       * `threadId` here is a PROVENANCE STAMP and nothing else — the comment
       * that used to sit on this line said so, and the code contradicted it.
       *
       * `PlanService.update` addressed the plan THROUGH `threadId`
       * (`getThreadPlanPath` / `attachPlanToThread`), so the synthetic id
       * resolved to no plan, took the create branch, wrote a plan file and a
       * version row, and then threw NOT_FOUND attaching it to a thread that
       * does not exist. `update_plan` could never succeed on this channel, and
       * every retry left another orphan (`auth-rollout-2.md`, `-3.md`, …) in the
       * user's spec repo. It was reachable from the generated MCP config entry, i.e.
       * from every editor an upgrading user opens.
       *
       * `target: 'explicit'` is the fix and matches what the catalog already
       * says: a plan is addressed by `path`, and the thread binding is a default
       * of the `internal` channel, not part of the operation. `update_plan`
       * here never creates; a new plan comes from `create_plan` (0.2.98), which
       * founds its own carrier thread and so needs no thread from this mount.
       */
      server: buildPlanToolsServer({
        threadId: 'mcp-external',
        target: 'explicit',
        planService: deps.planService,
        pageVersions: deps.pageVersions,
      }, deps.projectId),
    });
  }

  if (set.briefTools) {
    servers.push({
      name: 'brief-tools',
      // Explicit mode: no thread, so every call names its brief. See
      // `requiresExplicitBriefTarget` in `operations/profiles.ts`.
      server: buildBriefToolsServer(
        { briefService: deps.briefService, target: 'explicit' },
        deps.projectId,
      ),
    });
  }

  // 2.1.4 (M23): no `patch-tools` here. `create_patch` is `mcp: n/a` — a patch has
  // one producer, the implementer in the `cli` channel (plus REST) — and the
  // thread-bound `get_patch` / `mark_patch_applied` need a thread anchored in a
  // patch, which an external connection never has.

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
   * 0.2.99 — M37, unconditional for the same reason: both operations are
   * read-class, so every profile admits them — `brief` above all, since the
   * briefing methodology lives in a subfile of the active writing style. Unlike
   * the turn's copy this one carries `list_skills`: an outside caller has no
   * `<available_skills>` block. Reading crosses to this channel; INJECTION does
   * not (listing block, UI chrome, built-in subagent stay internal).
   */
  servers.push({
    name: 'skill-tools',
    server: buildSkillToolsServer(deps.skillRegistry, deps.projectId, { resolver: deps.skillResolver }),
  });

  // Plugin-contributed servers LAST — see the ordering note above.
  // Narrowed by the same rule the turn handler uses (`poolSelector`), applied
  // by the host before a factory runs: `brief` builds only `release-tools`.
  for (const entry of deps.pluginHost.buildMcpServers({ include: poolSelector(set.pluginServers) })) {
    // `buildMcpServers()` returns the host-owned `McpServerFactory` view. Every
    // in-repo and plugin server is built through the facade, so `.tools` is
    // present; a handle without it contributes nothing to enumerate and is
    // dropped by the merge below rather than mounted blind.
    servers.push({ name: entry.name, server: entry.server as CapturedMcpServer });
  }

  /**
   * `transagent-tools` is absent BY CONSTRUCTION, not by policy — do not "add
   * it for parity". Its dispatcher recurses into `runAgentTurn` and needs
   * `AgentTurnDeps` plus a live parent thread to do so. An external connection
   * is explicitly not a turn and has neither, so there is nothing to build.
   *
   * `spec-skill-tools` (2.1.9, M52) is absent by its catalog row: the `mcp` cell
   * of `update_skill_file` is `n/a` — writing skills from outside is out of v1 —
   * so `set.specSkillTools` is deliberately not read here.
   */

  return servers;
}

export interface ExternalSurface {
  /** Merged, gated, deduplicated — in declaration order. */
  tools: readonly McpToolDeclaration[];
  byName: ReadonlyMap<string, McpToolDeclaration>;
  /** Sorted tool names — the fingerprint `tools/list_changed` is decided on. */
  toolNames: readonly string[];
  /**
   * The catalog scope of every tool, decided by one bounded rule: a tool is
   * `workspace`-scoped only when a HOST catalog row says so (`list_projects`,
   * `ask`); a plugin's tool, or one with no row, needs a project. The
   * workspace-bound mount reads it to know which tools take `project` per call.
   */
  scopeByName: ReadonlyMap<string, OperationScope>;
}

/**
 * Compose the surface as DECLARATIONS rather than as a connected server.
 *
 * The mount needs the two halves separately. Tool identity (name, description,
 * schema) is what a session advertises and must stay stable across a rebuild;
 * the handler is what has to be re-resolved, because it closes over services
 * belonging to one `ProjectContext` and that context can be invalidated and
 * released underneath an open connection. Returning a built server would have
 * fused the two, and a `tools/call` could not dispatch into the successor
 * context.
 */
/**
 * Composition memoized on the PLUGIN HOST's identity.
 *
 * The mount recomposes before every request, which is what makes a `tools/call`
 * after a rebuild reach the successor context — but composing means building
 * eight MCP servers and registering their zod schemas, measured at ~5.7 ms.
 * Paying that on every tool invocation is pure waste when nothing has changed.
 *
 * The host object is MOST of the key, because of how invalidation usually works
 * here: a plugin activated or deactivated goes through a config change, which
 * invalidates the `ProjectContext`, which builds a NEW `ProjectPluginHost`. So a
 * changed pool is a changed key, and an unchanged pool is a cache hit — a
 * rebuilt context is still reached rather than traded away for the speed.
 *
 * It is not ALL of the key, and assuming it was is what this second level fixes.
 * The memoized `McpToolDeclaration`s carry HANDLERS, and those handlers close
 * over the services captured on the first compose — `briefService` above all
 * (see `sourceServers` below, and the `const { briefService } = ctx` every
 * brief-tools handler closes over). "A config change builds a new host" is a
 * statement about ONE way the context is rebuilt, not about all of them: rebuild
 * the context without a config change and the host key can survive while
 * `briefService` is replaced, leaving cached handlers writing through a service
 * belonging to a disposed context. That is a mount-layer failure with no handler
 * execution and no error — the empty `tool_result` this release exists to end.
 *
 * So the key is (host, briefService, profile): the service identity changes on
 * every context rebuild, config change or not.
 *
 * `WeakMap`s at both object levels, so a disposed context's entry goes with it.
 */
const SURFACE_CACHE = new WeakMap<
  ProjectPluginHost,
  WeakMap<BriefService, Map<ChatContextType, ExternalSurface>>
>();

export function composeExternalSurface(deps: ExternalSurfaceDeps): ExternalSurface {
  const cached = SURFACE_CACHE.get(deps.pluginHost)?.get(deps.briefService)?.get(deps.profile);
  if (cached) return cached;
  const surface = composeUncached(deps);
  let byService = SURFACE_CACHE.get(deps.pluginHost);
  if (!byService) {
    byService = new WeakMap();
    SURFACE_CACHE.set(deps.pluginHost, byService);
  }
  let byProfile = byService.get(deps.briefService);
  if (!byProfile) {
    byProfile = new Map();
    byService.set(deps.briefService, byProfile);
  }
  byProfile.set(deps.profile, surface);
  return surface;
}

/**
 * Test seam: drop the memo for one host, to exercise a recomposition directly.
 *
 * Drops every `briefService` generation under that host — the seam is "forget
 * this host", and a caller that wanted one generation gone can just pass a new
 * service.
 */
export function __invalidateSurfaceCache(host: ProjectPluginHost): void {
  SURFACE_CACHE.delete(host);
}

function composeUncached(deps: ExternalSurfaceDeps): ExternalSurface {
  const pluginServers = pluginServerNamesFor(deps.pluginHost.listEntities().map((m) => m.type));
  // 2.1.26 (M12 `ecawzsbr`): the channel's closed profile table decides which
  // registry profile's set is rendered — `patch` degenerates to `chat`, and a
  // value outside the table throws here (the mount refuses it before this).
  const rendered = mcpRenderingProfile(deps.profile);

  return mergeServers(rendered, sourceServers(deps), pluginServers);
}

function mergeServers(
  rendered: ChatContextType,
  servers: Array<{ name: string; server: CapturedMcpServer }>,
  pluginServers: ReadonlySet<string>,
): ExternalSurface {
  const tools: McpToolDeclaration[] = [];
  const byName = new Map<string, McpToolDeclaration>();
  const scopeByName = new Map<string, OperationScope>();
  for (const { name, server } of servers) {
    // The per-tool profile gate, identical to the turn's — including the
    // fail-closed rule for a plugin's own server, which must hold on this
    // channel too: an external `ask` connection reaching `spreadsheet-tools`'
    // six mutating operations is the exact hole the gate was built to close.
    const gated = gateServer(rendered, name, server, pluginServers);
    if (!gated?.tools) continue;
    for (const tool of gated.tools) {
      if (byName.has(tool.name)) continue;
      byName.set(tool.name, tool);
      tools.push(tool);
      const op = pluginServers.has(name) ? undefined : CATALOG.get(tool.name);
      scopeByName.set(tool.name, op && op.contributedBy !== 'plugin' ? op.scope : 'project');
    }
  }

  return { tools, byName, toolNames: [...byName.keys()].sort(), scopeByName };
}

/**
 * The surface of a workspace with NO project to template from — only the
 * workspace-scoped servers, which need none. Gated like every other surface.
 */
export function composeWorkspaceScopedSurface(deps: {
  profile: ChatContextType;
  listProjects: () => ListProjectsResult;
  workspaceName: string;
}): ExternalSurface {
  const rendered = mcpRenderingProfile(deps.profile);
  const set = mcpServerSetForProfile(rendered);
  const servers: Array<{ name: string; server: CapturedMcpServer }> = [];
  if (set.c4sTools) servers.push({ name: 'c4s-tools', server: buildC4sToolsServer(deps.workspaceName) });
  servers.push({ name: 'workspace-tools', server: buildWorkspaceToolsServer(deps.listProjects) });
  return mergeServers(rendered, servers, new Set());
}

/** What `bindProjectPerCall` resolves a call's `project` argument into. */
export type ProjectCallTarget =
  | { ok: true; projectId: string; surface: ExternalSurface }
  | { ok: false; code: 'PROJECT_NOT_IN_WORKSPACE' | 'PROJECT_BUILD_FAILED'; message: string };

/**
 * The `project` argument every project-scoped tool takes on the workspace-bound
 * mount (M12 `np1dkobs`: there the parameter has NO default).
 *
 * Optional at the zod level on purpose: a zod-required argument is refused by
 * the SDK before the handler runs, with its own generic validation error — and
 * the contract says a missing or wrong `project` answers
 * `PROJECT_NOT_IN_WORKSPACE` with the list of ids. So the handler is where it is
 * enforced, and the description is where it is stated.
 *
 * Built in the SAME zod flavour as the shape it joins. The SDK refuses a shape
 * mixing v3 and v4 schemas (`Mixed Zod versions detected in object shape`), and
 * a plugin's tools may be declared with its own zod 3 — a v4 field injected into
 * such a shape threw out of `registerTool` on the first request.
 */
const PROJECT_CALL_ARGUMENT = z
  .string()
  .optional()
  .describe('Required on this connection: registry `id` of the project this call addresses, exactly as `list_projects` returns it. Not a name, not a path.');
const PROJECT_CALL_ARGUMENT_V3 = z3
  .string()
  .optional()
  .describe('Required on this connection: registry `id` of the project this call addresses, exactly as `list_projects` returns it. Not a name, not a path.');

export function projectCallArgumentFor(shape: Record<string, unknown>): unknown {
  const values = Object.values(shape);
  const isV3 = values.length > 0 && values.every((v) => !(v as { _zod?: unknown })._zod);
  return isV3 ? PROJECT_CALL_ARGUMENT_V3 : PROJECT_CALL_ARGUMENT;
}

/**
 * A declaration's input as a RAW shape, whichever of the forms the SDK accepts
 * it was declared in: a raw shape, or a whole `z.object(...)` (v4 keeps the
 * shape on `_zod.def.shape`, v3 on `.shape`). Spreading an object SCHEMA copies
 * its internals rather than its fields — the first build of this mount did that
 * and the SDK threw on the result. `null` for a schema with no object shape.
 */
function rawShapeOf(input: Record<string, unknown>): Record<string, unknown> | null {
  const v4 = (input as { _zod?: { def?: { shape?: unknown } } })._zod;
  if (v4) return typeof v4.def?.shape === 'object' ? (v4.def.shape as Record<string, unknown>) : null;
  if ((input as { _def?: unknown })._def) {
    const shape = (input as { shape?: unknown }).shape;
    return typeof shape === 'object' && shape !== null ? (shape as Record<string, unknown>) : null;
  }
  return input;
}

/**
 * Re-render a surface for the workspace-bound mount: every project-scoped tool
 * gets a `project` argument and resolves it PER CALL, so one session can address
 * different projects on different calls; workspace-scoped tools pass through
 * unchanged and need no project.
 *
 * The wrapping handler closes over `resolveTarget` only — never over the
 * template's declaration or context — and dispatches to the TARGET project's own
 * declaration of the same name. A tool the template advertises but the target
 * project lacks (a plugin active in one project only) answers `NOT_FOUND`.
 */
export function bindProjectPerCall(
  surface: ExternalSurface,
  resolveTarget: (project: string | undefined) => Promise<ProjectCallTarget>,
  workspaceScoped?: ExternalSurface,
): ExternalSurface {
  const tools: McpToolDeclaration[] = [];
  const byName = new Map<string, McpToolDeclaration>();
  for (const decl of surface.tools) {
    // A workspace-scoped tool answers from the MOUNT's workspace when the caller
    // supplies one, not from whatever the template project's context captured.
    const bound: McpToolDeclaration =
      surface.scopeByName.get(decl.name) === 'workspace'
        ? (workspaceScoped?.byName.get(decl.name) ?? decl)
        : bindOne(decl, resolveTarget);
    tools.push(bound);
    byName.set(bound.name, bound);
  }
  return { tools, byName, toolNames: surface.toolNames, scopeByName: surface.scopeByName };
}

function bindOne(
  decl: McpToolDeclaration,
  resolveTarget: (project: string | undefined) => Promise<ProjectCallTarget>,
): McpToolDeclaration {
  // Fields copied, `decl.handler` replaced: the bound declaration keeps no
  // reference to the template context's handler (see `registerOne`'s note).
  const name = decl.name;
  // An input that is not an object (no shape to extend) cannot carry `project`
  // as a field; such a tool keeps its schema and answers from the URL default.
  const shape = rawShapeOf(decl.inputSchema);
  return {
    ...decl,
    inputSchema: shape ? { project: projectCallArgumentFor(shape), ...shape } : decl.inputSchema,
    handler: async (args: Record<string, unknown>, extra: unknown) => {
      const { project, ...rest } = args;
      const target = await resolveTarget(typeof project === 'string' ? project.trim() || undefined : undefined);
      if (!target.ok) return toolError(target.code, target.message);
      const live = target.surface.byName.get(name);
      if (!live) {
        return toolError(
          'NOT_FOUND',
          `tool '${name}' is not available in project '${target.projectId}'`,
          'that project has a different plugin pool; its own catalog does not carry this tool',
        );
      }
      return live.handler(rest, extra);
    },
  };
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
