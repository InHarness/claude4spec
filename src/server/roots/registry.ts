/**
 * 2.1.8 — the root registry (M02 is its implementor).
 *
 * `list()` is `config.roots[]` (kind `pages`) followed by the five system roots
 * registered in code. Every per-file behaviour is gated on a root's KIND or on
 * a flag of that kind — never on a directory and never on an identifier:
 *  - the base root is recognised only by `builtin`;
 *  - a system root only by `kind`;
 *  - no module reads a directory from a config key or keeps its own dir list.
 */
import path from 'node:path';
import type { Root } from '../../shared/types.js';
import {
  KIND_DECLARATIONS,
  PAGES_KIND,
  registryList,
  type KindFlags,
  type RegistryRoot,
  type RootKind,
  type SystemRootKind,
} from '../../shared/root-kinds.js';

export type { RegistryRoot, RootKind, SystemRootKind } from '../../shared/root-kinds.js';

export class RootRegistry {
  private readonly roots: readonly RegistryRoot[];
  private readonly byId: ReadonlyMap<string, RegistryRoot>;

  constructor(userRoots: readonly Root[]) {
    this.roots = registryList(userRoots);
    this.byId = new Map(this.roots.map((r) => [r.id, r]));
  }

  /** Every root: user roots in `roots[]` order, then the system roots. */
  list(): readonly RegistryRoot[] {
    return this.roots;
  }

  get(id: string): RegistryRoot | undefined {
    return this.byId.get(id);
  }

  /** Roots of one kind, in registry order. */
  byKind(kind: RootKind): RegistryRoot[] {
    return this.roots.filter((r) => r.kind === kind);
  }

  /** The user roots (`kind: pages`) — the only addressable spaces. */
  pages(): RegistryRoot[] {
    return this.byKind(PAGES_KIND);
  }

  /** The single root of a system kind. */
  system(kind: SystemRootKind): RegistryRoot {
    const root = this.roots.find((r) => r.kind === kind);
    if (!root) throw new Error(`root registry: no root of kind '${kind}'`);
    return root;
  }

  /** The base root — the `pages` root carrying `builtin: true`. */
  builtin(): RegistryRoot {
    const root = this.roots.find((r) => r.builtin);
    if (!root) throw new Error('root registry: no root carries builtin: true');
    return root;
  }

  /** Roots whose kind carries the given flag value. */
  withFlag(flag: keyof KindFlags, value = true): RegistryRoot[] {
    return this.roots.filter((r) => KIND_DECLARATIONS[r.kind].flags[flag] === value);
  }

  /** Roots whose kind selects the reaction. */
  selecting(reactionId: string): RegistryRoot[] {
    return this.roots.filter((r) => KIND_DECLARATIONS[r.kind].reactions.includes(reactionId));
  }
}

/** Absolute dir of a registry root. */
export function rootDirAbs(cwd: string, root: Pick<RegistryRoot, 'dir'>): string {
  return path.resolve(cwd, root.dir);
}
