import type { ScopedWatchRegistrar, WatchOrigin, WatchPhase, WatchScope, WatchSubscriber } from './watcher.js';
import {
  fileMapFilter,
  type FileFormat,
  type KindDeclaration,
  type KindFlags,
  type RootKind,
  type VersionTrack,
} from '../../shared/root-kinds.js';

/**
 * 2.1.8 — reactions on two levels (M40).
 *
 * DEFINITION — `defineReaction({ id, phase, after, accepts, requires, factory })`,
 * registered once per process by the owning module, at process start.
 * `factory(ctx)` builds the handler in a project's context.
 *
 * BINDING — `bindReaction(id, source, kind, input)` on a context's {@link ReactionBinder},
 * done by the root-registry implementor (M02) for every root whose kind selected
 * the reaction. Underneath it is `subscribe(source, handler, { id, phase, after,
 * filter })`; the binding inherits the binder's scope. One definition is bound to N
 * sources. There are no wildcards: the implementor iterates the registry. Sources
 * outside the registry (`plugins:*`) are bound by their owner (M33).
 *
 * The handler contract is `onChange/onUnlink(scope, source, relPath, origin,
 * input)`: `input` is what the binding party passed — for a registry root, the
 * entry's `rootId` ({@link ReactionInput}). M40 carries it opaquely and knows
 * nothing about roots; reactions key their state `(rootId, path)` from it, not
 * from the source name. `after: [id]` names a definition and is resolved PER SOURCE by the
 * runtime: a definition not bound on a source satisfies the dependency, so the
 * reaction then runs on its own.
 */

/**
 * The reaction's input from its binding (L13): the id of the root-registry entry
 * the source was mounted for — a user root's id, or for a system root the id
 * equal to its kind (`plans`, `briefs`, `patches`, `entities`, `releases`).
 */
export interface ReactionInput {
  rootId: string;
}

/**
 * A bound reaction's handler: the watch subscriber contract plus the binding's
 * {@link ReactionInput}. A plain {@link WatchSubscriber} (which ignores the
 * input) is one too.
 */
export interface ReactionHandler {
  onChange(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin, input: ReactionInput): void | Promise<void>;
  onUnlink(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin, input: ReactionInput): void | Promise<void>;
}

/** The acceptance contract every reaction on registry roots declares. */
export interface ReactionDefinition<C> {
  /** Stable id — unique among definitions, never a phase name. */
  id: string;
  phase: WatchPhase;
  after?: readonly string[];
  /**
   * File-map formats this reaction runs on. The binding narrows the source to the
   * kind's entries of these formats (a mechanical path filter); every other file
   * of the source is skipped.
   */
  accepts: readonly FileFormat[];
  /**
   * Version tracks this reaction runs on, on top of `accepts`: only file-map
   * entries of these tracks pass the binding's filter. Omitted = any track.
   */
  acceptsTracks?: readonly VersionTrack[];
  /** Other reactions that must be selected on the SAME kind. Validated at context build. */
  requires?: readonly string[];
  /** Kind flags that must be `true` on the kind selecting this reaction (L13: requirements are reactions and flags). */
  requiresFlags?: readonly (keyof KindFlags)[];
  factory: (ctx: C) => ReactionHandler;
}

const PHASES: ReadonlySet<string> = new Set(['projection', 'notification', 'reload', 'write-back', 'capture']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DEFINITIONS = new Map<string, ReactionDefinition<any>>();

export function defineReaction<C>(def: ReactionDefinition<C>): void {
  if (PHASES.has(def.id)) throw new Error(`[m40] reaction id '${def.id}' collides with a phase name`);
  if (DEFINITIONS.has(def.id)) throw new Error(`[m40] duplicate reaction definition '${def.id}'`);
  DEFINITIONS.set(def.id, def);
}

/**
 * The requirements of every reaction a kind selects, checked at context build.
 * A kind that selects `m06-section-indexer` without `m06-anchor-injection`, or
 * without `references = true`, stops the build of the project context with an error.
 */
export function validateKindRequirements(decl: KindDeclaration): void {
  for (const id of decl.reactions) {
    const def = DEFINITIONS.get(id);
    if (!def) throw new Error(`root kind '${decl.kind}': unknown reaction '${id}'`);
    for (const req of def.requires ?? []) {
      if (!decl.reactions.includes(req)) {
        throw new Error(`root kind '${decl.kind}': reaction '${id}' requires '${req}' on the same kind`);
      }
    }
    for (const flag of def.requiresFlags ?? []) {
      if (!decl.flags[flag]) {
        throw new Error(`root kind '${decl.kind}': reaction '${id}' requires flag '${flag}' = true on the same kind`);
      }
    }
  }
}

/**
 * One context's binder: the scoped registrar plus the context the factories
 * build their handlers in. A factory runs at most once per context.
 */
export class ReactionBinder<C> {
  private readonly handlers = new Map<string, ReactionHandler>();
  /** `reactionId → sources` this context bound it on. */
  private readonly bound = new Map<string, Set<string>>();

  constructor(
    private readonly registrar: ScopedWatchRegistrar,
    private readonly ctx: C,
  ) {}

  /**
   * Fail-fast: an unknown definition id, or a source that is not mounted in this
   * scope (the runtime's own `subscribe` check), throws. `input` is handed to the
   * handler on every event of this binding — the root-registry implementor passes
   * the registry entry's `rootId` here.
   */
  bindReaction(id: string, source: string, kind: RootKind, input: ReactionInput): void {
    const def = DEFINITIONS.get(id) as ReactionDefinition<C> | undefined;
    if (!def) throw new Error(`[m40] cannot bind unknown reaction '${id}' to source '${source}'`);
    let handler = this.handlers.get(id);
    if (!handler) {
      handler = def.factory(this.ctx);
      this.handlers.set(id, handler);
    }
    const filter = fileMapFilter(kind, def.accepts, def.acceptsTracks);
    if (filter === undefined) {
      throw new Error(`[m40] reaction '${id}' accepts none of root kind '${kind}''s file-map entries`);
    }
    const h = handler;
    const bound: WatchSubscriber = {
      onChange: (scope, src, relPath, origin) => h.onChange(scope, src, relPath, origin, input),
      onUnlink: (scope, src, relPath, origin) => h.onUnlink(scope, src, relPath, origin, input),
    };
    this.registrar.subscribe(source, bound, { id, phase: def.phase, after: [...(def.after ?? [])], filter });
    const set = this.bound.get(id) ?? new Set<string>();
    set.add(source);
    this.bound.set(id, set);
  }

  /** Is the reaction bound on the source in this context? */
  isBound(id: string, source: string): boolean {
    return this.bound.get(id)?.has(source) ?? false;
  }
}
