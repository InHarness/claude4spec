/**
 * 2.1.8 — the ROOT REGISTRY's vocabulary: root kinds and their declarations.
 *
 * There is one registry of roots. Every entry has a KIND, and the kind alone
 * decides how a file under that root behaves — its file map, four policy flags
 * and the reactions that run on it. Nothing is decided by a directory or by an
 * identifier: the base root is recognised by `builtin`, a system root by `kind`.
 *
 * Two sources feed the registry:
 *  - USER roots come from `config.json` → `roots[]`. They are always of kind
 *    `pages` and carry exactly four fields `{ id, name, dir, builtin }`.
 *  - SYSTEM roots are registered here in code, one per kind, with a fixed
 *    directory `.claude4spec/<kind>`. They are never written to `config.json`
 *    and their directories cannot be moved.
 *
 * Pure data, shared by the server (registry, mounts, flags) and the client
 * (Settings overlap mirror) — no Node imports here.
 */
import {
  BRIEF_IMMUTABLE_FRONTMATTER_KEYS,
  PATCH_IMMUTABLE_FRONTMATTER_KEYS,
  PLAN_IMMUTABLE_FRONTMATTER_KEYS,
} from './entities.js';
import { hasDotSegment } from './page-files.js';

/** Kinds contributed by the core modules: M02 (pages), M10, M21, M23, M29. */
export type RootKind = 'pages' | 'plans' | 'briefs' | 'patches' | 'entities' | 'releases';

/** The five kinds whose single root is registered in code, in a fixed order. */
export const SYSTEM_ROOT_KINDS = ['plans', 'briefs', 'patches', 'entities', 'releases'] as const;
export type SystemRootKind = (typeof SYSTEM_ROOT_KINDS)[number];

/** The kind every `config.roots[]` entry has. */
export const PAGES_KIND = 'pages' as const;

/** A registry entry. For a system root `id === kind`. */
export interface RegistryRoot {
  id: string;
  name: string;
  dir: string;
  kind: RootKind;
  builtin: boolean;
}

/** Header contract of a markdown file-map entry (the artifact frontmatter guard reads it). */
export interface HeaderContract {
  /** `frontmatter.type` that identifies the file. */
  type: string;
  /** Keys set by the file's creator; never mutated by the app. */
  immutable: readonly string[];
  /** Keys mutable through `PATCH /api/artifacts/:kind/:path/frontmatter`. */
  mutable: readonly string[];
}

export type FileFormat = 'markdown' | 'json' | 'raw';
export type VersionTrack = 'file_version' | 'entity_version' | 'HEAD' | 'none';

/** One `pattern → format` line of a kind's ordered file map (first match wins). */
export interface FileMapEntry {
  /** Glob on the path relative to the root's dir. */
  pattern: string;
  format: FileFormat;
  track: VersionTrack;
  header?: HeaderContract;
}

export interface KindFlags {
  /** Files enter a release through their version track (only entries whose track is not `none`). */
  release: boolean;
  /** Markdown entries belong to the entity/section reference graph (validated, searched, rewritten). */
  references: boolean;
  /** With git disabled, the root's dir goes into the managed `.gitignore` block. */
  gitignore: boolean;
  /** `false` excludes the root's dir from the agent's direct file access (Read/Write/Edit/Bash). */
  agentDirectFs: boolean;
}

export interface KindDeclaration {
  kind: RootKind;
  /** `config` = N user roots from `config.roots[]`; `code` = exactly one root at `.claude4spec/<kind>`. */
  source: 'config' | 'code';
  sidebar: 'accordion' | 'hidden';
  fileMap: readonly FileMapEntry[];
  flags: KindFlags;
  /** Stable reaction ids bound on every root of this kind (plus the base `m02-file-changed`). */
  reactions: readonly string[];
}

/** The base reaction — bound on EVERY registry root; a kind cannot opt out. */
export const BASE_REACTION_ID = 'm02-file-changed';

export const PLAN_HEADER: HeaderContract = {
  type: 'plan',
  immutable: PLAN_IMMUTABLE_FRONTMATTER_KEYS,
  mutable: ['title', 'applied'],
};
export const BRIEF_HEADER: HeaderContract = {
  type: 'brief',
  immutable: BRIEF_IMMUTABLE_FRONTMATTER_KEYS,
  mutable: ['implemented'],
};
export const PATCH_HEADER: HeaderContract = {
  type: 'patch',
  immutable: PATCH_IMMUTABLE_FRONTMATTER_KEYS,
  // 0.2.14: `status` → `applied` (boolean), the same flag the plan carries.
  mutable: ['applied'],
};

export const KIND_DECLARATIONS: Readonly<Record<RootKind, KindDeclaration>> = {
  // M02
  pages: {
    kind: 'pages',
    source: 'config',
    sidebar: 'accordion',
    fileMap: [
      { pattern: '**/*.{md,mdx}', format: 'markdown', track: 'file_version' },
      { pattern: '**/*.html', format: 'raw', track: 'none' },
    ],
    flags: { release: true, references: true, gitignore: false, agentDirectFs: true },
    reactions: [
      'm06-anchor-injection',
      'm06-section-indexer',
      'm02-frontmatter-indexer',
      'm08-todos-indexer',
      'm14-link-indexer',
      'm14-rename-sync',
      'm17-capture',
    ],
  },
  // M10
  plans: {
    kind: 'plans',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [{ pattern: '*.md', format: 'markdown', track: 'file_version', header: PLAN_HEADER }],
    flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
    reactions: ['m06-anchor-injection', 'm02-frontmatter-indexer', 'm17-capture', 'm10-plan-updated'],
  },
  // M21
  briefs: {
    kind: 'briefs',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [{ pattern: '**/*.{md,mdx}', format: 'markdown', track: 'file_version', header: BRIEF_HEADER }],
    flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
    reactions: ['m02-frontmatter-indexer', 'm17-capture'],
  },
  // M23
  patches: {
    kind: 'patches',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [{ pattern: '**/*.{md,mdx}', format: 'markdown', track: 'file_version', header: PATCH_HEADER }],
    flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
    reactions: ['m02-frontmatter-indexer', 'm17-capture'],
  },
  // M29 — entity files keep their own track (`entity_version`); the release
  // flag is not what puts them in a release.
  entities: {
    kind: 'entities',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [{ pattern: '**/*.json', format: 'json', track: 'entity_version' }],
    flags: { release: false, references: false, gitignore: false, agentDirectFs: false },
    reactions: ['m29-entity-indexer'],
  },
  // M29
  releases: {
    kind: 'releases',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [{ pattern: '*.json', format: 'json', track: 'none' }],
    flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
    reactions: ['m29-release-cache'],
  },
};

const SYSTEM_ROOT_NAMES: Record<SystemRootKind, string> = {
  plans: 'Plans',
  briefs: 'Briefs',
  patches: 'Patches',
  entities: 'Entities',
  releases: 'Releases',
};

/** The fixed directory of a system root, relative to the project. */
export function systemRootDir(kind: SystemRootKind): string {
  return `.claude4spec/${kind}`;
}

/** The five system roots, in code. */
export const SYSTEM_ROOTS: readonly RegistryRoot[] = SYSTEM_ROOT_KINDS.map((kind) => ({
  id: kind,
  name: SYSTEM_ROOT_NAMES[kind],
  dir: systemRootDir(kind),
  kind,
  builtin: false,
}));

/**
 * The registry list: the user roots (always kind `pages`, `roots[]` order),
 * then the system roots. Shared by the server's `RootRegistry` and the client.
 */
export function registryList(userRoots: ReadonlyArray<{ id: string; name: string; dir: string; builtin: boolean }>): RegistryRoot[] {
  return [
    ...userRoots.map((r) => ({ id: r.id, name: r.name, dir: r.dir, kind: PAGES_KIND, builtin: r.builtin }) as RegistryRoot),
    ...SYSTEM_ROOTS,
  ];
}

/**
 * The dirs of every registry root whose kind has `agentDirectFs = false` — the
 * agent's implicit deny-set, cwd-relative (Settings → Agent "Always excluded").
 */
export function agentDeniedDirs(userRoots: ReadonlyArray<{ id: string; name: string; dir: string; builtin: boolean }>): string[] {
  return registryList(userRoots)
    .filter((r) => !KIND_DECLARATIONS[r.kind].flags.agentDirectFs)
    .map((r) => r.dir);
}

/**
 * Directories the app WRITES to besides the registry roots — part of the D4
 * collision set, shared by the server's `validateRootDirs` and the client
 * mirror. 0.1.104: `.claude4spec/skills` dropped — nothing writes there anymore.
 */
export const RESERVED_WRITE_TARGETS = ['.claude4spec/plugins'] as const;

/** Identifiers a user root may never take — each would be a second root under one address. */
export function isSystemRootId(id: string): boolean {
  return (SYSTEM_ROOT_KINDS as readonly string[]).includes(id);
}

export function kindDeclaration(kind: RootKind): KindDeclaration {
  return KIND_DECLARATIONS[kind];
}

/** The header contract of a kind's markdown entry, if it declares one. */
export function headerContractOf(kind: RootKind): HeaderContract | undefined {
  return KIND_DECLARATIONS[kind].fileMap.find((e) => e.format === 'markdown' && e.header)?.header;
}

/** Does this kind's file map carry any markdown entry? */
export function kindHasMarkdown(kind: RootKind): boolean {
  return KIND_DECLARATIONS[kind].fileMap.some((e) => e.format === 'markdown');
}

/** Does the kind select the given reaction id? */
export function kindSelects(kind: RootKind, reactionId: string): boolean {
  return KIND_DECLARATIONS[kind].reactions.includes(reactionId);
}

/**
 * The single glob that matches a kind's file-map entries of the given formats —
 * and, when `tracks` is given, of those version tracks only (M17's `m17-capture`
 * accepts `file_version` entries in any format). Patterns of the shape `**\/*.{a,b}` / `**\/*.x` / `*.x` are merged by their
 * extensions; the runtime filter understands exactly those shapes. Entries of
 * different depths (`*.x` next to `**\/*.y`) cannot be merged without widening
 * the shallow one, so that combination is refused rather than silently widened.
 */
export function fileMapFilter(
  kind: RootKind,
  formats: readonly FileFormat[],
  tracks?: readonly VersionTrack[],
): string | undefined {
  const entries = KIND_DECLARATIONS[kind].fileMap.filter(
    (e) => formats.includes(e.format) && (tracks === undefined || tracks.includes(e.track)),
  );
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0]!.pattern;
  const exts: string[] = [];
  let deep: boolean | undefined;
  for (const e of entries) {
    const m = /^(\*\*\/)?\*\.(?:\{([^}]+)\}|([A-Za-z0-9]+))$/.exec(e.pattern);
    if (!m) throw new Error(`root kind '${kind}': file-map pattern '${e.pattern}' cannot be merged into one filter`);
    const entryDeep = m[1] !== undefined;
    if (deep !== undefined && deep !== entryDeep) {
      throw new Error(`root kind '${kind}': file-map patterns of different depths cannot be merged into one filter`);
    }
    deep = entryDeep;
    exts.push(...(m[2] ? m[2].split(',') : [m[3]!]));
  }
  return `${deep ? '**/' : ''}*.{${exts.join(',')}}`;
}

/**
 * Normalised ("" for the project dir), slash-separated, no trailing slash, with
 * `.` / empty segments dropped and `..` resolved — so `pages/../.claude4spec/plans`
 * and `.claude4spec//plans` compare equal to the system root they alias. (Pure
 * string work: this module is shared with the client and imports nothing from Node.)
 */
function normDir(dir: string): string {
  const out: string[] = [];
  for (const seg of dir.trim().replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function isUnder(parent: string, child: string): boolean {
  if (parent === child) return true;
  if (parent === '') return true;
  return child.startsWith(parent + '/');
}

/**
 * Does root A's NAMESPACE reach B's directory? A namespace is the files under a
 * root's `dir`, excluding every subtree that passes through a dot-segment — so a
 * root at `.` never reaches `.claude4spec/*`.
 */
function namespaceReaches(container: string, child: string): boolean {
  if (!isUnder(container, child)) return false;
  const rel = container === '' ? child : child.slice(container.length + 1);
  if (rel === '') return true;
  return !hasDotSegment(rel);
}

/** Do two namespaces overlap? Symmetric; the dot-subtree exclusion holds both ways. */
export function namespacesOverlap(aDir: string, bDir: string): boolean {
  const a = normDir(aDir);
  const b = normDir(bDir);
  if (a === b) return true;
  return namespaceReaches(a, b) || namespaceReaches(b, a);
}
