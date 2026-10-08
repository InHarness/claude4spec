/**
 * 2.1.8 — the root registry (M02 is its implementor).
 *
 * `list()` is `config.roots[]` (kind `pages`) followed by the system roots
 * registered in code (one per kind with source `code`). Every per-file behaviour is gated on a root's KIND or on
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
  kindHasFacade,
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

  /**
   * The user roots (`kind: pages`) — the spaces agent discovery addresses
   * (`list_pages`, `get_page`, `search_pages`, `overview`).
   */
  pages(): RegistryRoot[] {
    return this.byKind(PAGES_KIND);
  }

  /**
   * 2.1.9 — the roots WITH A FACADE: every root whose kind's `sidebar` is not
   * `hidden` (M02 `m02multidir`), in registry order. These — and only these —
   * are what the page routes `/api/pages/:rootId/*` and the page write
   * operations address; agent discovery stays on {@link pages}.
   */
  facades(): RegistryRoot[] {
    return this.roots.filter((r) => kindHasFacade(r.kind));
  }

  /** 2.1.9 — the roots of kinds with source `code` (the system roots), in registry order. */
  codeRoots(): RegistryRoot[] {
    return this.roots.filter((r) => KIND_DECLARATIONS[r.kind].source === 'code');
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
