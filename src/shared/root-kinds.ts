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
 *  - SYSTEM roots are registered here in code, one per kind whose declaration
 *    has `source: 'code'`, with a fixed directory `.claude4spec/<kind>`. They
 *    are never written to `config.json` and their directories cannot be moved.
 *    2.1.9: which kinds those are — and so which identifiers are reserved and
 *    which directories are system directories — follows from the declarations
 *    below (`source`), never from a list kept beside them.
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

/** Kinds contributed by the core modules: M02 (pages), M10 (plans), M21 (briefs), M23 (patches), M29 (entities), M17 (releases). */
export type RootKind = 'pages' | 'plans' | 'briefs' | 'patches' | 'entities' | 'releases';

/** The kind every `config.roots[]` entry has. */
export const PAGES_KIND = 'pages' as const;

/**
 * A kind whose single root is registered in code (`source: 'code'`). The list
 * of such kinds is {@link SYSTEM_ROOT_KINDS}, derived from the declarations.
 */
export type SystemRootKind = Exclude<RootKind, typeof PAGES_KIND>;

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

/**
 * 2.1.9 (L13 „Pole sidebar”) — one element of a root's accordion array: `key`
 * is stable and unique within the root's array (it keys the UI's expanded
 * state), `label` is shown, `path` is the subtree relative to the root's dir
 * (`''` = the whole root). The array's order is the accordions' order.
 */
export interface SidebarAccordionItem {
  key: string;
  label: string;
  path: string;
}

/**
 * The reducer's input: the paths of every file of the root (every file-map
 * entry, root-relative) and the parsed frontmatter of the markdown files that
 * match the reducer's `glob`. File content never enters the input.
 */
export interface SidebarReducerInput {
  paths: readonly string[];
  frontmatter: ReadonlyMap<string, Record<string, unknown>>;
}

/**
 * The general form of the `sidebar` field: a rule computing the root's ordered
 * accordion array from its content alone. `glob` (root-relative, the syntax of
 * {@link globToRegExp}) names the files whose frontmatter enters the input.
 */
export interface SidebarReducer {
  glob: string;
  reduce(input: SidebarReducerInput): SidebarAccordionItem[];
}

/** `hidden` and `accordion` are the reducer's special cases and declare no rule. */
export type SidebarDeclaration = 'hidden' | 'accordion' | SidebarReducer;

export interface KindDeclaration {
  kind: RootKind;
  /** `config` = N user roots from `config.roots[]`; `code` = exactly one root at `.claude4spec/<kind>`. */
  source: 'config' | 'code';
  /**
   * How the kind's roots enter the sidebar's page tree. Any value other than
   * `hidden` also gives every root of the kind a `PagesService` facade.
   */
  sidebar: SidebarDeclaration;
  fileMap: readonly FileMapEntry[];
  flags: KindFlags;
  /** Stable reaction ids bound on every root of this kind (plus the base `m02-file-changed`). */
  reactions: readonly string[];
}

/** The base reaction — bound on EVERY registry root; a kind cannot opt out. */
export const BASE_REACTION_ID = 'm02-file-changed';

/**
 * 2.1.9 — M02's sidebar-reducer reaction (`x6avfb5q`): bound by the implementor,
 * on top of the kind's own list, on every root whose kind's `sidebar` declares a
 * reducer. A kind never lists it.
 */
export const SIDEBAR_REDUCER_ID = 'm02-sidebar-reducer';

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
  // M21 (bcpvtk7p) — one root, reserved id `briefs`, fixed dir `.claude4spec/briefs`
  // (no config key). Map `*.md` → markdown with the brief header contract
  // (immutable type/from_release/to_release/roots/generated_at, mutable
  // `implemented`), track `file_version`. Neither `m06-anchor-injection` nor
  // `m06-section-indexer`: a brief has no injected anchors and no section index.
  briefs: {
    kind: 'briefs',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [{ pattern: '*.md', format: 'markdown', track: 'file_version', header: BRIEF_HEADER }],
    flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
    reactions: ['m02-frontmatter-indexer', 'm17-capture'],
  },
  // M23 (yp20j51v) — one root, reserved id `patches`, fixed dir
  // `.claude4spec/patches` (no config key). Map `*.md` → markdown with the patch
  // header contract (immutable type/brief/patch_kind/created_at/created_by,
  // mutable `applied`), track `file_version`. No anchors, no section index.
  patches: {
    kind: 'patches',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [{ pattern: '*.md', format: 'markdown', track: 'file_version', header: PATCH_HEADER }],
    flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
    reactions: ['m02-frontmatter-indexer', 'm17-capture'],
  },
  // M29 (f952122v) — two entries, first match wins: `tags.json` (tag
  // definitions, M18's semantics) travels on the `HEAD` track — a release
  // carries the copy from HEAD; `<type>/<slug>.json` entity snapshots on
  // `entity_version`, written by the entity write primitive. `release` = yes;
  // `references` = no does not gate slug-rename propagation into entity files
  // (a separate mechanism over this root, M19).
  entities: {
    kind: 'entities',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [
      { pattern: 'tags.json', format: 'json', track: 'HEAD' },
      { pattern: '*/*.json', format: 'json', track: 'entity_version' },
    ],
    flags: { release: true, references: false, gitignore: false, agentDirectFs: false },
    reactions: ['m29-entity-indexer'],
  },
  // M17 (1dufnk2n) — exactly one root, reserved id `releases`, fixed dir
  // `.claude4spec/releases` (no config key). One entry: `*.json` — the release
  // metadata record (`name`, `slug`, `description`, `createdAt`, `createdBy`,
  // `roots`), immutable once created except for an edit of the latest release;
  // track `none`. Flags: only `gitignore`. Reaction: `m29-release-cache`. The
  // root is not in the `release` flag set, but the git-anchored release diff
  // always adds it to its pathspecs beside the release-flag roots (m17reldiff).
  releases: {
    kind: 'releases',
    source: 'code',
    sidebar: 'hidden',
    fileMap: [{ pattern: '*.json', format: 'json', track: 'none' }],
    flags: { release: false, references: false, gitignore: true, agentDirectFs: false },
    reactions: ['m29-release-cache'],
  },
};

/**
 * The kinds whose single root is registered in code — every declaration with
 * `source: 'code'`, in the order the kinds are declared (registration order).
 * Derived, so a module adding such a kind adds its root, its reserved id and its
 * fixed directory in one place.
 */
export const SYSTEM_ROOT_KINDS: readonly SystemRootKind[] = (Object.keys(KIND_DECLARATIONS) as RootKind[]).filter(
  (kind): kind is SystemRootKind => KIND_DECLARATIONS[kind].source === 'code',
);

/** The fixed directory of a system root, relative to the project. */
export function systemRootDir(kind: SystemRootKind): string {
  return `.claude4spec/${kind}`;
}

/** The system roots — one per kind with source `code`, `id = kind`, `name` = the kind capitalised. */
export const SYSTEM_ROOTS: readonly RegistryRoot[] = SYSTEM_ROOT_KINDS.map((kind) => ({
  id: kind,
  name: kind.charAt(0).toUpperCase() + kind.slice(1),
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

/**
 * The id of the single system root of `kind` — looked up BY KIND in the code
 * source of the registry. Consumers that address a system root (the briefs root
 * a patch resolves its `brief:` against, …) ask this, never spell the id.
 */
export function systemRootId(kind: SystemRootKind): string {
  return SYSTEM_ROOTS.find((r) => r.kind === kind)!.id;
}

/**
 * Identifiers a user root may never take — each would be a second root under one
 * address. 2.1.9 (M01 `m01rootsval` pt 6): the ids of the registry's roots of
 * kinds with source `code`, read from the registry's code source, not a list.
 */
export function isSystemRootId(id: string): boolean {
  return SYSTEM_ROOTS.some((r) => r.id === id);
}

/**
 * The kind of the system root registered under `rootId`, or `undefined` for any
 * other id (a user root, kind `pages`). Consumers that react per system root —
 * e.g. the client's `file:changed` routing — branch on this KIND, never on the
 * identifier itself.
 */
export function systemRootKindOf(rootId: string): SystemRootKind | undefined {
  return SYSTEM_ROOTS.find((r) => r.id === rootId)?.kind as SystemRootKind | undefined;
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

/**
 * 2.1.9 — does every root of this kind get a `PagesService` facade? Exactly the
 * kinds whose `sidebar` is not `hidden` (M02 `m02multidir`).
 */
export function kindHasFacade(kind: RootKind): boolean {
  return KIND_DECLARATIONS[kind].sidebar !== 'hidden';
}

/** The kind's sidebar reducer, when its `sidebar` field declares one (not `hidden` / `accordion`). */
export function sidebarReducerOf(kind: RootKind): SidebarReducer | undefined {
  const sidebar = KIND_DECLARATIONS[kind].sidebar;
  return typeof sidebar === 'object' ? sidebar : undefined;
}

/**
 * The accordion array of the special cases, computed straight from the
 * declaration: `hidden` → `[]`, `accordion` (and the fallback of a failing
 * reducer) → one element `{ key: root id, label: root name, path: '' }`.
 */
export function accordionCase(root: Pick<RegistryRoot, 'id' | 'name'>, sidebar: 'hidden' | 'accordion'): SidebarAccordionItem[] {
  return sidebar === 'hidden' ? [] : [{ key: root.id, label: root.name, path: '' }];
}

/** `''` for the whole root; slash-separated, no leading `./`, no trailing slash. */
function normSubtree(p: string): string | null {
  const out: string[] = [];
  const raw = p.trim().replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    out.push(seg);
  }
  return out.join('/');
}

function subtreesOverlap(a: string, b: string): boolean {
  return a === b || a === '' || b === '' || a.startsWith(b + '/') || b.startsWith(a + '/');
}

/**
 * L13 result rules, enforced by the implementor on a reducer's output: `path`
 * lies within the root, `key` is unique in the array, subtrees are disjoint. An
 * element breaking a rule is skipped with a warning (`warn`); of two overlapping
 * subtrees the LATER element is skipped. Malformed elements (non-string fields)
 * are skipped the same way. Order of the surviving elements is kept.
 */
export function enforceAccordionRules(
  items: readonly unknown[],
  warn: (message: string) => void = () => {},
): SidebarAccordionItem[] {
  const out: SidebarAccordionItem[] = [];
  const keys = new Set<string>();
  for (const raw of items) {
    const item = raw as Partial<SidebarAccordionItem> | null;
    if (!item || typeof item.key !== 'string' || typeof item.label !== 'string' || typeof item.path !== 'string') {
      warn(`sidebar accordion skipped — not a { key, label, path } element: ${JSON.stringify(raw)}`);
      continue;
    }
    const p = normSubtree(item.path);
    if (p === null) {
      warn(`sidebar accordion '${item.key}' skipped — path '${item.path}' is outside the root`);
      continue;
    }
    if (keys.has(item.key)) {
      warn(`sidebar accordion '${item.key}' skipped — duplicate key`);
      continue;
    }
    const clash = out.find((o) => subtreesOverlap(o.path, p));
    if (clash) {
      warn(`sidebar accordion '${item.key}' skipped — subtree '${p}' overlaps '${clash.key}' ('${clash.path}')`);
      continue;
    }
    keys.add(item.key);
    out.push({ key: item.key, label: item.label, path: p });
  }
  return out;
}

/** Does the kind select the given reaction id? */
export function kindSelects(kind: RootKind, reactionId: string): boolean {
  return KIND_DECLARATIONS[kind].reactions.includes(reactionId);
}

/**
 * Minimal glob → RegExp over a slash-separated relative path: `**\/` (zero or
 * more leading segments), `**`, `*` and `?` (within one segment), `{a,b}`
 * alternation (each alternative is itself a glob, no nesting). Shared by the
 * file-map lookup below and M40's mechanical subscription filter, so a kind's
 * entry and the filter derived from it match the same paths. Deliberately not a
 * general glob engine.
 */
export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${globBody(glob)}$`);
}

function globBody(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close !== -1) {
        const alts = glob.slice(i + 1, close).split(',');
        out += `(?:${alts.map(globBody).join('|')})`;
        i = close;
        continue;
      }
      out += '\\{';
    } else if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:[^/]*/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return out;
}

/**
 * The kind's file-map entry a root-relative path falls under — first match wins,
 * as the map is ordered. `undefined` = the path is not an entry of the kind (the
 * root's tree does not show it). Patterns are the globs {@link globToRegExp}
 * understands (`**\/*.{a,b}`, `*.x`, `tags.json`, `*\/*.json`, …).
 */
export function fileMapEntryOf(kind: RootKind, relPath: string): FileMapEntry | undefined {
  const p = relPath.replace(/\\/g, '/');
  return KIND_DECLARATIONS[kind].fileMap.find((e) => globToRegExp(e.pattern).test(p));
}

/**
 * The single glob that matches a kind's file-map entries of the given formats —
 * and, when `tracks` is given, of those version tracks only (M17's `m17-capture`
 * accepts `file_version` entries in any format). Extension-shaped patterns
 * (`**\/*.{a,b}` / `**\/*.x` / `*.x`) of one depth are merged by their
 * extensions; any other set of entries becomes a `{p1,p2}` alternation of the
 * patterns themselves (e.g. the `entities` kind: `{tags.json,*\/*.json}`), which
 * matches exactly the paths the entries match. A brace pattern cannot be nested
 * in such an alternation, so that combination is refused rather than widened.
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
  const shapes = entries.map((e) => /^(\*\*\/)?\*\.(?:\{([^}]+)\}|([A-Za-z0-9]+))$/.exec(e.pattern));
  const depths = new Set(shapes.map((m) => (m ? m[1] !== undefined : null)));
  if (shapes.every((m) => m !== null) && depths.size === 1) {
    const exts = shapes.flatMap((m) => (m![2] ? m![2].split(',') : [m![3]!]));
    return `${shapes[0]![1] !== undefined ? '**/' : ''}*.{${exts.join(',')}}`;
  }
  if (entries.some((e) => /[{}]/.test(e.pattern))) {
    throw new Error(`root kind '${kind}': file-map patterns cannot be merged into one filter`);
  }
  return `{${entries.map((e) => e.pattern).join(',')}}`;
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
