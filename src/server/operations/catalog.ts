/**
 * L3 — the operation catalog.
 *
 * Up to 0.2.12 the unit of the system was a "tool", and there were four of them
 * for every capability: an in-process MCP tool, an external `c4s-reader` MCP
 * tool, a `c4s` command, and (sometimes) a REST route. Each was declared
 * independently — its own zod shape, its own prose description, its own error
 * codes — so the four drifted: something reachable over MCP was unreachable over
 * REST and vice versa, and the same refusal came back under different names.
 *
 * 0.2.13 replaces that with ONE declaration per operation, RENDERED into four
 * channels. This module owns the declaration; the renderings live with their
 * transports.
 *
 * ## The hard invariant — `locus wykonania`
 *
 * Executing a catalog operation belongs to the SERVER PROCESS. Channels differ
 * only in their input adapter. Stated as a rule the code can be held to: **one
 * function per operation.** A channel adapter has no semantics of its own — it
 * maps a wire format onto a call of the owning core's function and maps the
 * result back. The moment an adapter decides something the other three adapters
 * do not, the four surfaces have started drifting again.
 *
 * ## What may enter the catalog
 *
 * The subject of an operation must be specification CONTENT (pages, sections,
 * entities, tags, references, briefs, patches, plans, releases) or an agent turn
 * over that content. Deliberately outside: `trust-plugins`, `create-plugin`,
 * `install-skills`, SSE, upload, settings, git, `remote-account`, and workspace
 * registry mutations. One conscious navigational exception is IN the catalog:
 * `list_projects` — its subject is the workspace registry rather than
 * specification content, but without it a project-scoped catalog is unreachable
 * from outside.
 *
 * ## Naming (binding across all four channels)
 *
 * - canonical name: `verb_noun`, snake_case, plural for batches —
 *   `create_entities`, `list_entities`, `tag_entity`, `link_dto`
 * - MCP server name: kebab-case — `entity-tools`, `reference-tools`
 * - `internal` / `mcp` rendering: `mcp__{server}__{tool}`
 * - `cli` rendering: the kebab-case command 1:1 — `c4s list-entities`
 * - `rest` rendering: method + path per L4 — `POST /api/entities/:type`
 * - parameters and output fields are camelCase (`pagePath`, `pageTree`)
 *
 * The verb vocabulary for NEW names is closed — see {@link CLOSED_VERBS}. It is
 * not enforced at registration: the catalog inherited names that predate the
 * rule (`overview`, `check_consistency`, `file_patch`, `abort_turn`), and
 * renaming a shipped tool is a breaking change for every external client that
 * has it in a config. `register()` therefore validates the SHAPE (snake_case,
 * unique) and leaves verb choice to review.
 */

import type { ZodRawShape } from 'zod';

/** The four rendering channels. A declaration must answer for all of them. */
export type ChannelName = 'internal' | 'cli' | 'mcp' | 'rest';

/**
 * One cell of the operation × channel matrix.
 *
 * An ABSENT cell is a declaration error, not a default — `register()` rejects
 * it. Channel parity is the expectation; `na` is the exception and has to carry
 * its reason in writing, because "this channel doesn't have it" is exactly the
 * kind of gap that used to go unnoticed for a release at a time.
 */
export type ChannelCell =
  /** The channel renders this operation itself. */
  | { readonly kind: 'direct' }
  /** Reachable, but through another catalog operation (e.g. a generic proxy). */
  | { readonly kind: 'via'; readonly operation: string; readonly reason: string }
  /** Deliberately not rendered here. */
  | { readonly kind: 'na'; readonly reason: string };

export const direct = (): ChannelCell => ({ kind: 'direct' });
export const via = (operation: string, reason: string): ChannelCell => ({ kind: 'via', operation, reason });
export const na = (reason: string): ChannelCell => ({ kind: 'na', reason });

/** `workspace` operations address the registry; everything else addresses one project. */
export type OperationScope = 'project' | 'workspace';

/**
 * How much it costs to invoke, declared once per operation:
 * - `direct` — the caller shapes the call. Cheap, deterministic, batchable.
 * - `agent-mediated` — costs a turn of the built-in agent.
 * - `human-mediated` — needs a person in the UI.
 */
export type OperationMediation = 'direct' | 'agent-mediated' | 'human-mediated';

/** Closed vocabulary, declared once per operation, identical in every channel. */
export type SideEffect = 'none' | 'file' | 'db' | 'ui-notify';

/**
 * What the operation is ABOUT — the axis a context profile filters on.
 * See `profiles.ts`: a profile admits a set of these, and an operation whose
 * class is not admitted never reaches `tools/list`.
 */
export type OperationClass =
  /** Reads specification content. Never mutates. */
  | 'read'
  /** Mutates specification content (entities, pages, sections, tags). */
  | 'write'
  /** Brief and patch artifacts. */
  | 'brief'
  /** Plan artifacts. */
  | 'plan'
  /** Agent turns — spawning, aborting. */
  | 'turn'
  /** Cross-spec peer consultation. */
  | 'peer';

/** The verb vocabulary for names coined from 0.2.13 on. Not retroactive. */
export const CLOSED_VERBS = [
  'get',
  'list',
  'search',
  'create',
  'update',
  'delete',
  'add',
  'find',
] as const;

export interface OperationDeclaration {
  /** Canonical name — `verb_noun`, snake_case, plural for batches. */
  readonly name: string;
  /** One line, LLM-facing. Reused verbatim by every channel that needs a description. */
  readonly summary: string;
  readonly scope: OperationScope;
  readonly mediation: OperationMediation;
  readonly opClass: OperationClass;
  /**
   * Zod RAW SHAPE, not `z.object(...)` — the third argument of
   * `mcpTool(name, description, zodShape, handler)`. Keeping the raw shape is
   * what lets a rendering wrap it however its channel needs: `z.object(shape)`
   * for REST body validation, the shape itself for MCP.
   */
  readonly inputSchema: ZodRawShape;
  /** Every code this operation can answer with, in ANY channel. */
  readonly errorCodes: readonly string[];
  readonly sideEffects: readonly SideEffect[];
  /**
   * Whether repeating the call with the same input leaves the same state.
   * Batch operations additionally document partial-success/per-item semantics
   * in their `summary` — they are not transactional.
   */
  readonly idempotent: boolean;
  /** All four cells required. */
  readonly channels: Readonly<Record<ChannelName, ChannelCell>>;
}

const CHANNELS: readonly ChannelName[] = ['internal', 'cli', 'mcp', 'rest'];

/** `verb_noun`, snake_case, no leading/trailing/double underscores. */
const NAME_SHAPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export class OperationCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationCatalogError';
  }
}

/**
 * The registry. An instance rather than a module-level singleton so tests can
 * build an isolated catalog without leaking registrations between cases; the
 * process-wide one is {@link CATALOG}.
 */
export class OperationCatalog {
  private readonly byName = new Map<string, OperationDeclaration>();

  register(op: OperationDeclaration): OperationDeclaration {
    if (!NAME_SHAPE.test(op.name)) {
      throw new OperationCatalogError(
        `operation name '${op.name}' is not snake_case verb_noun — see CLOSED_VERBS in catalog.ts`,
      );
    }
    if (this.byName.has(op.name)) {
      throw new OperationCatalogError(`operation '${op.name}' is already registered`);
    }
    // An empty cell is a declaration error, never a default. TypeScript already
    // requires all four on a literal; this catches a declaration assembled at
    // runtime (a plugin's, in particular) before it can reach a channel.
    for (const channel of CHANNELS) {
      if (!op.channels[channel]) {
        throw new OperationCatalogError(
          `operation '${op.name}' has no '${channel}' cell — declare 'direct', 'via' or 'na' with a reason`,
        );
      }
    }
    this.byName.set(op.name, op);
    return op;
  }

  get(name: string): OperationDeclaration | undefined {
    return this.byName.get(name);
  }

  /** Throws rather than returning undefined — for renderings that cannot proceed without it. */
  require(name: string): OperationDeclaration {
    const op = this.byName.get(name);
    if (!op) throw new OperationCatalogError(`operation '${name}' is not in the catalog`);
    return op;
  }

  list(): OperationDeclaration[] {
    return [...this.byName.values()];
  }

  /** Every operation the given channel renders itself. */
  listForChannel(channel: ChannelName): OperationDeclaration[] {
    return this.list().filter((op) => op.channels[channel].kind === 'direct');
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }
}

/** The process-wide catalog. Seeded by `registerCoreOperations()` in `core-operations.ts`. */
export const CATALOG = new OperationCatalog();
