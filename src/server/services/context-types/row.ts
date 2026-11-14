/**
 * 2.1.88 (L15 `6jkqb2h4`, M44 `zvy49ysg` / `7q3ny9bb` / `8rnqx0vu`) — one row of the
 * context-type registry, in the columns of the L15 module slice schema.
 *
 * The registry is no longer a closed list written in one place: each value's row
 * is contributed by the module that brings the value (`chat` M05, `brief` M21,
 * `patch` M23, `ask` M11 — see `rows/`), and `registry.ts` only collects them
 * into the code map (M44 `k3gkrn09`). What a row does NOT hold — the mount
 * condition proper to one server (e.g. "top-level thread only") — stays with the
 * server's owner (`mcp/transagent-tools.ts`, `mcp/run-tools.ts`), collected in
 * `SERVER_MOUNT_CONDITIONS` in `services/turn-mcp-servers.ts`.
 */

import type { ToolGroup } from '@inharness-ai/agent-adapters';
import type { ChatContextType } from '../../../shared/entities.js';
import type { OperationClass } from '../../operations/catalog.js';
import type { PromptCompositionDecl } from '../system-prompt/types.js';

/** `Wejście` — the ways a thread of this value comes into being. */
export type ContextTypeEntryPoint = 'default' | 'new-thread' | 'consultation';

/**
 * `Postura` — whether `chat_thread.plan_mode` binds. `pinned` forces the given
 * plan-mode value every turn whatever the flag says; `unavailable` means the
 * value does not know plan mode at all (the flag never binds, plan mode is off).
 */
export type ContextTypePosture =
  | { kind: 'follow-thread' }
  | { kind: 'pinned'; planMode: boolean; reason: string }
  | { kind: 'unavailable'; reason: string };

/** The pool position of the `Serwery` column (M44 `7q3ny9bb`). */
export const POOL = 'pool';

/**
 * M44 `7q3ny9bb` — the base set: the servers every registry value mounts with no
 * declaration in its row. `skill-tools` is here because the active writing style
 * attaches to every value, so its read channel must be everywhere (M15 `qb6jqwdh`).
 */
export const BASE_SERVER_SET: readonly string[] = ['skill-tools', 'workspace-tools'];

export interface ContextTypeRow {
  /** `Wartość` — the discriminator literal. */
  value: ChatContextType;
  /** The module that contributes the row (its sole owner). */
  owner: string;
  /**
   * The requirements of the contributing module (L19 `Moduł wymaga`). An empty
   * `requiresCapabilities` cell inherits these; a filled one adds to them.
   */
  moduleRequires: readonly string[];
  /** `Wymaga możliwości` — capabilities required ON TOP of the module's. */
  requiresCapabilities: readonly string[];
  /** `Wejście` — `[]` stands for `—` (artifact- or child-only). */
  entry: readonly ContextTypeEntryPoint[];
  /**
   * `Serwery` — positive enumeration over the base set: {@link POOL} (the whole
   * pool) and/or servers named one by one (a pool server named here is taken
   * from the pool). A server the row does not name, the value does not get.
   */
  servers: readonly string[];
  /** `Powłoka` — the chrome variant (the frontend switches on it). */
  uiChrome: 'overlay' | 'brief-detail';
  /** `Postura`. */
  posture: ContextTypePosture;
  /**
   * `Grupy wbudowane` — groups this row ADDITIONALLY denies: `'none'` (`—`),
   * `'all'` (every group of the agent library) or a set. Only tightens: the turn
   * unions it with the project setting and the plan preset.
   */
  builtinGroups: 'none' | 'all' | readonly ToolGroup[];
  /** `Klasy operacji` — the classes the turn's profile gate admits. */
  operationClasses: 'all' | readonly OperationClass[];
  /** `Subagent` — the built-in definition injected into turns of this value. */
  subagent: 'spec-explore' | 'diff-explore';
  /** `Zadania w tle` — whether the row admits background tasks (a turn may still refuse them by origin). */
  backgroundTasks: 'allowed' | 'disabled';
  /** `Reguły domenowe` — the body rendered into `<interaction_context>` (owned by the contributor). */
  interactionRules: string;
  /** `Kompozycja` — `'default'` or the contributor's own recipe. */
  promptComposition: PromptCompositionDecl;
  /** `Wątek` — the thread column carrying the artifact reference, or `null` (`—`). */
  threadArtifact: 'plan_path' | 'brief_path' | 'patch_path' | null;
}

/** Every capability the row needs to exist in a project: the module's plus its own. */
export function rowRequiredCapabilities(row: ContextTypeRow): readonly string[] {
  return [...new Set([...row.moduleRequires, ...row.requiresCapabilities])];
}

/** Does the row's `Serwery` column (or the base set) name this server? */
export function rowNamesServer(row: ContextTypeRow, server: string): boolean {
  return BASE_SERVER_SET.includes(server) || row.servers.includes(server);
}

/** Does the row take the whole pool (`pula`)? */
export function rowTakesPool(row: ContextTypeRow): boolean {
  return row.servers.includes(POOL);
}
