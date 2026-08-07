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
 * | profile | operations in the `mcp` channel |
 * |---|---|
 * | `chat` (default) | the full catalog — entity CRUD, section writes, artifacts, agent turns |
 * | `ask` | read-class entries + plan tools — a peer may leave a plan, it may not mutate the spec |
 * | `brief` | brief entries + read entries; brief operations require an EXPLICIT brief-addressing parameter |
 * | `patch` | the same set as `chat` |
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
 * Four of the five members are DERIVED from `operationClasses` below — they are
 * the coarse, server-level shadow of the real per-operation gate, kept because
 * the turn dispatcher still assembles servers rather than tools. `pluginServers`
 * is declared rather than derived: it selects between the full entity/reference
 * pool and the narrow read-only release whitelist, which is a statement about
 * server composition, not about an operation class.
 */
export interface McpServerSet {
  /** `'all'` = full entity-plugin servers + tag/reference; `'release-only'` = `BRIEF_ALLOWED_PLUGIN_MCP`. */
  pluginServers: 'all' | 'release-only';
  planTools: boolean;
  briefTools: boolean;
  c4sTools: boolean;
  transagentTools: boolean;
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
  },
  brief: {
    operationClasses: new Set<OperationClass>(['read', 'brief']),
    pluginServers: 'release-only',
    requiresExplicitBriefTarget: true,
    builtinPosture: 'follow-thread',
  },
  patch: {
    operationClasses: new Set(CHAT_CLASSES),
    pluginServers: 'all',
    requiresExplicitBriefTarget: false,
    builtinPosture: 'follow-thread',
  },
  ask: {
    // A consulted peer reads and may leave a plan. It cannot mutate the spec, and
    // it cannot consult onward (`peer`) or delegate (`turn`) — the recursion
    // guard is a property of the profile, so no channel can route around it.
    operationClasses: new Set<OperationClass>(['read', 'plan']),
    pluginServers: 'all',
    requiresExplicitBriefTarget: false,
    builtinPosture: 'force-plan',
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
    transagentTools: operationClasses.has('turn'),
  };
}

/** Exported for the completeness test — every declared class must be reachable from some profile. */
export const KNOWN_OPERATION_CLASSES = ALL_CLASSES;
