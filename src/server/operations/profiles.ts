/**
 * L3 — the context profile registry.
 *
 * A profile is the **only hard gate** on which operations a caller can reach.
 * The word "hard" is the contract: an operation outside the profile does not
 * appear in `tools/list` and cannot be invoked by name (the caller gets "unknown
 * tool"). It is a gate, not a sentence in a prompt asking the model not to.
 *
 * A profile is fixed when the connection/thread is established and is IMMUTABLE
 * for its whole life. An external connection that names no profile gets `chat` —
 * the same definition the internal channel renders.
 *
 * 2.1.26 (M12 `ecawzsbr`) — the rendering in the `mcp` channel. The reads
 * COMMON to every profile are the read tools of the discovery core and of the
 * skills registry (the `c4s-reader` server's own), `list_projects` and the
 * release reads; plans and briefs go through their explicit-addressing tools.
 *
 * | profile | operations in the `mcp` channel |
 * |---|---|
 * | `chat` (default) | common reads, plans with their writes, `describe_entity_type`, writes of pages, sections, entities and tags, DTO links, release create/edit, and peer consultation (`ask`) |
 * | `ask` | TRIM to the common reads, plans with their writes and `describe_entity_type` — a peer may leave a plan, it may not mutate the spec |
 * | `brief` | TRIM to the common reads and the brief tools — no plans, no `describe_entity_type`; a brief is addressed by an EXPLICIT `path` |
 * | `patch` | DEGENERATES to `chat` — see {@link MCP_CHANNEL_PROFILES} |
 *
 * That table is CLOSED in the `mcp` channel: {@link MCP_CHANNEL_PROFILES} names
 * its four rows literally and is not derived from this registry, so a fifth
 * context type added here is refused by the external mount until that table
 * gains a row for it — never silently rendered as the widest profile.
 *
 * (2.1.18, M44 `3f5ej79s`: inside the app `patch` differs from `chat` by one
 * SERVER — it has no `transagent-tools`. That is a turn-mount column below
 * (`transagentTools`), not an operation class: the `mcp` channel exposes no
 * bubble-spawning operation in any profile, so this table is unaffected.)
 *
 * `patch` matching `chat` is deliberate and worth stating: the patch thread's
 * semantics used to be carried by a prompt block, which this channel does not
 * have. The caller reconstructs it on its side by READING the patch with a read
 * operation — so the toolset is `chat`'s, and nothing about a narrower toolset
 * would have carried the missing semantics anyway.
 *
 * The registry filters on {@link OperationClass}, not on individual names: a new
 * catalog entry is gated by the class it declares, so adding an operation cannot
 * silently widen a profile. That is the property the previous design lacked —
 * `McpServerSet` gated whole MCP SERVERS, so it could not express "this profile
 * gets `get_page` but not `create_tag`" when both live on `reference-tools`.
 */

import type { ChatContextType } from '../../shared/entities.js';
import type { OperationClass, OperationDeclaration } from './catalog.js';

/**
 * Which built-in MCP servers a profile mounts.
 *
 * Three of the six members are DERIVED from `operationClasses` below — they are
 * the coarse, server-level shadow of the real per-operation gate, kept because
 * the turn dispatcher still assembles servers rather than tools. `pluginServers`
 * is declared rather than derived: it selects between the full entity/reference
 * pool and the narrow read-only release whitelist, which is a statement about
 * server composition, not about an operation class. `specSkillTools` (2.1.9) is
 * declared for the same kind of reason: whether a type may write the project's
 * skill packages is a row of the context-type registry, not a consequence of it
 * admitting writes. `transagentTools` (2.1.18) is declared for the same reason:
 * `patch` admits the `turn` class and still does not mount it.
 */
/**
 * What `pluginServers: 'release-only'` actually names.
 *
 * M21 m05ctxreg: a brief profile gets brief-tools (addressed per the channel)
 * plus read-only release-tools, and nothing else from the plugin pool — not the
 * generic `entity-tools`, not a per-type custom server, not `reference-tools`.
 *
 * 0.2.13 moved it here from `routes/agent-turn.ts`, where it was private to the
 * turn dispatcher. It is the definition of a value declared in this file, and
 * the external MCP surface has to select servers by exactly the same rule — a
 * second copy over there would have been one of the two-sources-for-one-fact
 * pairs this release exists to remove.
 */
export const BRIEF_ALLOWED_PLUGIN_MCP: ReadonlySet<string> = new Set(['release-tools']);

export interface McpServerSet {
  /** `'all'` = full entity-plugin servers + tag/reference; `'release-only'` = `BRIEF_ALLOWED_PLUGIN_MCP`. */
  pluginServers: 'all' | 'release-only';
  planTools: boolean;
  briefTools: boolean;
  c4sTools: boolean;
  /**
   * 2.1.18 (M44 `3f5ej79s`, M23 `jbcb06l2`) — `transagent-tools` (`runTransagent`).
   * DECLARED per profile, never derived from the `turn` class: only `chat` names
   * it. `patch` admits every class `chat` does (its `mcp`-channel rendering
   * degenerates to `chat`) and still does not get it — a patch thread neither
   * orchestrates nor lists — and a new context type does not inherit it even by
   * declaring "the full `chat` set". The per-thread half of the rule
   * (`parent_thread_id IS NULL`) is applied by the turn builder on top.
   */
  transagentTools: boolean;
  /**
   * 2.1.9 (M52 `hdkx97wq`, M44 `3f5ej79s`) — `spec-skill-tools`, the write channel
   * of the project's own skill packages (`update_skill_file`). DECLARED per
   * profile, never derived from `write`: a new context type does not inherit it
   * by admitting writes — it gets it only by an explicit `true` in its row.
   */
  specSkillTools: boolean;
}

export interface ProfileDefinition {
  /** The operation classes this profile admits. Everything else is unreachable. */
  readonly operationClasses: ReadonlySet<OperationClass>;
  readonly pluginServers: 'all' | 'release-only';
  /**
   * `brief` only. A brief operation invoked from an external connection without
   * a brief-addressing parameter must fail VALIDATION naming the missing field —
   * never fall back to "the" brief. There is no ambient brief on a connection;
   * the internal channel's thread binding is a rendering of that channel, not
   * part of the operation contract.
   */
  readonly requiresExplicitBriefTarget: boolean;
  /** `'force-plan'` pins plan mode on regardless of the thread flag (read-only peer). */
  readonly builtinPosture: 'follow-thread' | 'force-plan';
  /**
   * 0.2.87 (M44): which built-in tools the turn may hold at all, independent of
   * plan mode. `'project-setting'` follows `agent.disableDirectFilesystemAccess`;
   * `'none'` denies `file-read` / `file-write` / `shell` whatever that flag says.
   * `brief` is `'none'`: its content arrives through `get_brief`, so there is no
   * path-traversal surface to hand it — `Read` included.
   */
  readonly builtinTools: 'project-setting' | 'none';
  /**
   * 0.2.87 (M44): background-task policy, declared per value rather than inferred
   * from another column. `ask` is `'disabled'` — its consumer is headless and holds
   * the request for the whole turn, so a hold would block it for minutes with no
   * visible signal. Per-THREAD reasons (a transagent child, a denied shell) are
   * applied on top by the turn builder; they cannot re-enable what this denies.
   */
  readonly backgroundTasks: 'allowed' | 'disabled';
  /**
   * 2.1.9 (M44 `3f5ej79s`) — whether the turn mounts `spec-skill-tools`. An
   * explicit column rather than a derivation from the admitted classes: the
   * read server (`skill-tools`) is inherited by every type unconditionally, the
   * write server by none — `chat` and `patch` name it, `brief` (a release note,
   * not agent instructions) and `ask` (a consultation answers, it does not
   * write the project — M11 `6exnmup9`) do not.
   */
  readonly specSkillTools: boolean;
  /**
   * 2.1.18 (M44 `3f5ej79s`) — whether the turn mounts `transagent-tools`. Declared,
   * not derived from the `turn` class (see `McpServerSet.transagentTools`): `chat`
   * only. Orchestration belongs to the top-level `chat` thread alone.
   */
  readonly transagentTools: boolean;
}

const ALL_CLASSES: readonly OperationClass[] = ['read', 'write', 'brief', 'plan', 'turn', 'peer'];

/**
 * `chat` and `patch` admit every class EXCEPT `brief`: the built-in chat agent
 * applies patches, it never files them, and brief authoring is its own context.
 */
const CHAT_CLASSES: readonly OperationClass[] = ['read', 'write', 'plan', 'turn', 'peer'];

export const PROFILES: Record<ChatContextType, ProfileDefinition> = {
  chat: {
    operationClasses: new Set(CHAT_CLASSES),
    pluginServers: 'all',
    requiresExplicitBriefTarget: false,
    builtinPosture: 'follow-thread',
    builtinTools: 'project-setting',
    backgroundTasks: 'allowed',
    specSkillTools: true,
    transagentTools: true,
  },
  brief: {
    operationClasses: new Set<OperationClass>(['read', 'brief']),
    pluginServers: 'release-only',
    requiresExplicitBriefTarget: true,
    builtinPosture: 'follow-thread',
    builtinTools: 'none',
    backgroundTasks: 'allowed',
    specSkillTools: false,
    transagentTools: false,
  },
  patch: {
    operationClasses: new Set(CHAT_CLASSES),
    pluginServers: 'all',
    requiresExplicitBriefTarget: false,
    builtinPosture: 'follow-thread',
    builtinTools: 'project-setting',
    backgroundTasks: 'allowed',
    specSkillTools: true,
    transagentTools: false,
  },
  ask: {
    // A consulted peer reads and may leave a plan. It cannot mutate the spec, and
    // it cannot consult onward (`peer`) or delegate (`turn`) — the recursion
    // guard is a property of the profile, so no channel can route around it.
    // ASSUMPTION:dev-2613 — in the `mcp` channel `read` here also admits the
    // catalogued type-specific reads of plugin servers (`get_range`), so a
    // skeleton record and its windowed content stay on one connection (M12
    // `4cli19xs`); the M12 `ask` row names only the common reads.
    operationClasses: new Set<OperationClass>(['read', 'plan']),
    pluginServers: 'all',
    requiresExplicitBriefTarget: false,
    builtinPosture: 'force-plan',
    builtinTools: 'project-setting',
    backgroundTasks: 'disabled',
    specSkillTools: false,
    transagentTools: false,
  },
};

/** An external connection that names no profile gets this one. */
export const DEFAULT_PROFILE: ChatContextType = 'chat';

/** Does this profile admit the operation? The single predicate every gate uses. */
export function profileAdmits(profile: ChatContextType, op: OperationDeclaration): boolean {
  return PROFILES[profile].operationClasses.has(op.opClass);
}

/**
 * The coarse server-level shadow of the gate, for the turn dispatcher.
 *
 * Derived so the two cannot drift: widening a profile's classes widens the
 * mounted servers in the same edit. `pluginServers` passes through from the
 * declaration — see the note on {@link McpServerSet}.
 */
export function mcpServerSetForProfile(profile: ChatContextType): McpServerSet {
  const { operationClasses, pluginServers } = PROFILES[profile];
  return {
    pluginServers,
    planTools: operationClasses.has('plan'),
    briefTools: operationClasses.has('brief'),
    c4sTools: operationClasses.has('peer'),
    // Declared, not derived — see `McpServerSet.transagentTools`.
    transagentTools: PROFILES[profile].transagentTools,
    // Declared, not derived — see `McpServerSet.specSkillTools`.
    specSkillTools: PROFILES[profile].specSkillTools,
  };
}

/** Exported for the completeness test — every declared class must be reachable from some profile. */
export const KNOWN_OPERATION_CLASSES = ALL_CLASSES;

/**
 * The profile names, at runtime.
 *
 * Derived from `PROFILES` rather than written out again. `ChatContextType` is a
 * type and cannot be enumerated at runtime, which is what made a hand-kept
 * second list tempting.
 *
 * 2.1.26: the external MCP mount no longer validates `?profile=` against this —
 * its table is closed ({@link MCP_CHANNEL_PROFILES}), so a profile added to the
 * registry is NOT nameable on that wire until the table gains its row.
 */
export const KNOWN_PROFILES = Object.keys(PROFILES) as readonly ChatContextType[];

/**
 * 2.1.26 (M12 `ecawzsbr`) — the profile table of the `mcp` channel, CLOSED.
 *
 * Four rows, written out literally rather than derived from {@link PROFILES} or
 * {@link KNOWN_PROFILES}: this table is not a mirror of the registry. A value the
 * registry knows and this table does not gets NO default branch — the external
 * mount refuses a connection naming it before exposing any catalog. Closing the
 * other way, a silent fallback to the widest profile, would make the gate open
 * itself on the day someone adds a fifth value, which is exactly the day it has
 * to hold.
 *
 * Each row names the registry profile whose operation set the channel renders
 * for it. `patch` renders `chat`'s: inside the app the two differ only in the
 * prompt layer (the `<current_patch>` identity block and the type's domain
 * rules) and in bubble orchestration, and this channel has neither — no prompt
 * of ours, and no bubble-spawning operation in any profile. A profile that does
 * not differ by its operation set once the prompt pipeline is gone is not a
 * separate profile here.
 */
export const MCP_CHANNEL_PROFILES = {
  chat: 'chat',
  ask: 'ask',
  brief: 'brief',
  patch: 'chat',
} as const satisfies Readonly<Record<string, ChatContextType>>;

/** A profile name the `mcp` channel accepts — a row of {@link MCP_CHANNEL_PROFILES}. */
export type McpChannelProfile = keyof typeof MCP_CHANNEL_PROFILES;

/** The accepted names, in the table's order. */
export const MCP_CHANNEL_PROFILE_NAMES = Object.keys(MCP_CHANNEL_PROFILES) as readonly McpChannelProfile[];

/** Is `value` a row of the closed `mcp` table? Registry membership alone is not enough. */
export function isMcpChannelProfile(value: string): value is McpChannelProfile {
  return Object.prototype.hasOwnProperty.call(MCP_CHANNEL_PROFILES, value);
}

/**
 * The registry profile whose operation set the `mcp` channel renders for this
 * connection profile (`patch` → `chat`). A value outside the closed table is a
 * programming error here — the mount rejects it at connection set-up — so this
 * throws rather than defaulting.
 */
export function mcpRenderingProfile(profile: ChatContextType): ChatContextType {
  if (!isMcpChannelProfile(profile)) {
    throw new Error(`profile '${profile}' has no rendering in the mcp channel`);
  }
  return MCP_CHANNEL_PROFILES[profile];
}
