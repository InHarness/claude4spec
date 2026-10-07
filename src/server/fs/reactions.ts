import type { ScopedWatchRegistrar, WatchPhase, WatchSubscriber } from './watcher.js';
import {
  fileMapFilter,
  type FileFormat,
  type KindDeclaration,
  type RootKind,
} from '../../shared/root-kinds.js';

/**
 * 2.1.8 — reactions on two levels (M40).
 *
 * DEFINITION — `defineReaction({ id, phase, after, accepts, requires, factory })`,
 * registered once per process by the owning module, at process start.
 * `factory(ctx)` builds the handler in a project's context.
 *
 * BINDING — `bindReaction(id, source, kind)` on a context's {@link ReactionBinder},
 * done by the root-registry implementor (M02) for every root whose kind selected
 * the reaction. Underneath it is `subscribe(source, handler, { id, phase, after,
 * filter })`; the binding inherits the binder's scope. One definition is bound to N
 * sources. There are no wildcards: the implementor iterates the registry. Sources
 * outside the registry (`plugins:*`) are bound by their owner (M33).
 *
 * The handler contract is unchanged: `onChange/onUnlink(scope, source, relPath,
 * origin)`. `after: [id]` names a definition and is resolved PER SOURCE by the
 * runtime: a definition not bound on a source satisfies the dependency, so the
 * reaction then runs on its own.
 */

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
  /** Other reactions that must be selected on the SAME kind. Validated at context build. */
  requires?: readonly string[];
  factory: (ctx: C) => WatchSubscriber;
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
 * A kind that selects `m06-section-indexer` without `m06-anchor-injection` stops
 * the build of the project context with an error.
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
  }
}

/**
 * One context's binder: the scoped registrar plus the context the factories
 * build their handlers in. A factory runs at most once per context.
 */
export class ReactionBinder<C> {
  private readonly handlers = new Map<string, WatchSubscriber>();
  /** `reactionId → sources` this context bound it on. */
  private readonly bound = new Map<string, Set<string>>();

  constructor(
    private readonly registrar: ScopedWatchRegistrar,
    private readonly ctx: C,
  ) {}

  /**
   * Fail-fast: an unknown definition id, or a source that is not mounted in this
   * scope (the runtime's own `subscribe` check), throws.
   */
  bindReaction(id: string, source: string, kind: RootKind): void {
    const def = DEFINITIONS.get(id) as ReactionDefinition<C> | undefined;
    if (!def) throw new Error(`[m40] cannot bind unknown reaction '${id}' to source '${source}'`);
    let handler = this.handlers.get(id);
    if (!handler) {
      handler = def.factory(this.ctx);
      this.handlers.set(id, handler);
    }
    const filter = fileMapFilter(kind, def.accepts);
    if (filter === undefined) {
      throw new Error(`[m40] reaction '${id}' accepts none of root kind '${kind}''s file-map formats`);
    }
    this.registrar.subscribe(source, handler, { id, phase: def.phase, after: [...(def.after ?? [])], filter });
    const set = this.bound.get(id) ?? new Set<string>();
    set.add(source);
    this.bound.set(id, set);
  }

  /** Is the reaction bound on the source in this context? */
  isBound(id: string, source: string): boolean {
    return this.bound.get(id)?.has(source) ?? false;
  }
}
