/**
 * 2.1.77 — M57 `Project Type Capabilities (L19)`, the layer's runtime (how-mode).
 *
 * A CAPABILITY names a function a project may lack (never a project type). The
 * capability registry is the SUM of the `Wnoszone możliwości` tables of every
 * module (M57 `wd9engvy`): each name has exactly one owner, and two declarations
 * of one name are a registration error, not a precedence rule. The registry is
 * built in host code at process start, BEFORE the project-type registry, and is
 * validated there (M57 `rgkqgr2b`):
 *
 *  - every name in `Zależy od` is declared;
 *  - the dependency graph is acyclic;
 *  - every project-type entry names only declared capabilities, and its set is
 *    closed under dependencies ({@link CapabilityRegistry.assertTypeCapabilities}).
 *
 * A violation stops the server start with `PROJECT_TYPE_REGISTRY_INVALID` and the
 * name of the faulty declaration. There is no runtime check: declarations are static.
 *
 * What a module loses without a capability is said by its OWNER, not here; this
 * file only collects the declarations (name, owner, dependencies).
 */

export const PROJECT_TYPE_REGISTRY_INVALID = 'PROJECT_TYPE_REGISTRY_INVALID';

/** One row of a module's `Wnoszone możliwości` table. */
export interface CapabilityDeclaration {
  /** Kebab-case, unique across the host. Names a function, never a project type. */
  name: string;
  /** The module that wrote the row — the only module that says what disappears without it. */
  owner: string;
  /** `Zależy od` — the capabilities this one makes no sense without; `[]` for `—`. */
  dependsOn: readonly string[];
}

/** Start-time refusal of the capability or project-type registry (M57 `rgkqgr2b`, `91ci7cqx`). */
export class ProjectTypeRegistryError extends Error {
  readonly code = PROJECT_TYPE_REGISTRY_INVALID;
  /** The faulty declaration: a capability name, or a project-type slug. */
  readonly declaration: string;
  constructor(declaration: string, message: string) {
    super(`${PROJECT_TYPE_REGISTRY_INVALID}: ${declaration} — ${message}`);
    this.name = 'ProjectTypeRegistryError';
    this.declaration = declaration;
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── the owners' declarations (one row each in this window) ──────────────────────

/** M13 `btrsmaos` — entity types in full. */
export const ENTITIES_CAPABILITY: CapabilityDeclaration = { name: 'entities', owner: 'M13', dependsOn: [] };
/** M21 `dcagtfpe` — briefs in full. */
export const BRIEFS_CAPABILITY: CapabilityDeclaration = { name: 'briefs', owner: 'M21', dependsOn: [] };
/** M01 `9t587fj1` — user roots besides the primary one. */
export const MULTI_ROOT_CAPABILITY: CapabilityDeclaration = { name: 'multi-root', owner: 'M01', dependsOn: [] };
/** M52 `0ay8qh6u` — exposing the project as a global skill. */
export const SKILL_EXPOSURE_CAPABILITY: CapabilityDeclaration = {
  name: 'skill-exposure',
  owner: 'M52',
  dependsOn: [],
};

/** The host's declarations, in registration order. */
export const HOST_CAPABILITY_DECLARATIONS: readonly CapabilityDeclaration[] = [
  ENTITIES_CAPABILITY,
  BRIEFS_CAPABILITY,
  MULTI_ROOT_CAPABILITY,
  SKILL_EXPOSURE_CAPABILITY,
];

/** The validated capability registry. Immutable after construction. */
export class CapabilityRegistry {
  private readonly byName: ReadonlyMap<string, CapabilityDeclaration>;

  constructor(byName: ReadonlyMap<string, CapabilityDeclaration>) {
    this.byName = byName;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  get(name: string): CapabilityDeclaration | undefined {
    return this.byName.get(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  list(): CapabilityDeclaration[] {
    return [...this.byName.values()];
  }

  /**
   * The third start check (M57 `rgkqgr2b`): a project-type entry names only
   * declared capabilities and its set is closed under `Zależy od`. Throws
   * {@link ProjectTypeRegistryError} naming the type entry. The type registry
   * (L20) calls it for every entry it registers.
   */
  assertTypeCapabilities(typeSlug: string, capabilities: readonly string[]): void {
    const set = new Set(capabilities);
    for (const c of capabilities) {
      const decl = this.byName.get(c);
      if (!decl) {
        throw new ProjectTypeRegistryError(typeSlug, `names undeclared capability "${c}"`);
      }
      for (const dep of decl.dependsOn) {
        if (!set.has(dep)) {
          throw new ProjectTypeRegistryError(
            typeSlug,
            `capability "${c}" depends on "${dep}", which the type's set does not contain`,
          );
        }
      }
    }
  }
}

/**
 * Builds and validates the capability registry. Throws
 * {@link ProjectTypeRegistryError} (code `PROJECT_TYPE_REGISTRY_INVALID`) naming
 * the faulty declaration: a non-kebab or duplicate name, an undeclared
 * dependency, or a dependency cycle.
 */
export function buildCapabilityRegistry(declarations: readonly CapabilityDeclaration[]): CapabilityRegistry {
  const byName = new Map<string, CapabilityDeclaration>();
  for (const d of declarations) {
    if (!KEBAB.test(d.name)) {
      throw new ProjectTypeRegistryError(d.name, `capability name is not kebab-case (owner ${d.owner})`);
    }
    const existing = byName.get(d.name);
    if (existing) {
      throw new ProjectTypeRegistryError(
        d.name,
        `capability is declared twice — by "${existing.owner}" and by "${d.owner}"`,
      );
    }
    byName.set(d.name, d);
  }
  for (const d of byName.values()) {
    for (const dep of d.dependsOn) {
      if (!byName.has(dep)) {
        throw new ProjectTypeRegistryError(d.name, `depends on undeclared capability "${dep}"`);
      }
    }
  }
  // Acyclicity — depth-first with a grey/black colouring; the first back edge
  // names the declaration that closes the cycle.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string, trail: string[]): void => {
    const s = state.get(name);
    if (s === 'done') return;
    if (s === 'visiting') {
      const cycle = [...trail.slice(trail.indexOf(name)), name].join(' → ');
      throw new ProjectTypeRegistryError(name, `capability dependencies form a cycle: ${cycle}`);
    }
    state.set(name, 'visiting');
    for (const dep of byName.get(name)!.dependsOn) visit(dep, [...trail, name]);
    state.set(name, 'done');
  };
  for (const name of byName.keys()) visit(name, []);
  return new CapabilityRegistry(byName);
}

/**
 * The host's capability registry — built once per process. The first call
 * validates; a faulty declaration throws and the server does not start.
 */
let hostRegistry: CapabilityRegistry | null = null;
export function hostCapabilityRegistry(): CapabilityRegistry {
  hostRegistry ??= buildCapabilityRegistry(HOST_CAPABILITY_DECLARATIONS);
  return hostRegistry;
}

/**
 * A project's capability set (M57 `rdztxzb8`): derived from its type, fixed for
 * the life of the project context, so a consumer may read it once, at build time.
 */
export type ProjectCapabilities = ReadonlySet<string>;

export function projectCapabilitySet(capabilities: readonly string[]): ProjectCapabilities {
  return Object.freeze(new Set(capabilities)) as ProjectCapabilities;
}

/** `true` when every name of `requires` is in the project's set — the shared active-row rule. */
export { satisfies } from '../../shared/project-types.js';
