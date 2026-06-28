import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { InlineSkill } from '@inharness-ai/agent-adapters';
import type { WritingStyleContribution } from '../../shared/plugin-host/manifest.js';
import { readConfig } from '../config.js';

export type SkillScope = 'writing-style' | 'contextual';

/**
 * Where a skill was discovered: in-package bundle, a user `.claude/skills` root,
 * or a plugin contribution (M15). Selection precedence is
 * `project > global > plugin > bundled` — project/global are both `user`
 * (ordered by root scan), `plugin` outranks `bundled` but loses to `user`.
 */
export type SkillSource = 'bundled' | 'user' | 'plugin';

export interface SkillMetadata {
  slug: string;
  title: string;
  description: string;
  version: number;
  language: 'en' | 'pl';
  scope: SkillScope;
  source: SkillSource;
  path: string;
}

/**
 * A root scanned by {@link SkillRegistry.load}. Roots are scanned in array order
 * (highest precedence first); on a slug collision the first root wins, so callers
 * pass project before global before bundled. See {@link findSkillsRoots}.
 */
export interface SkillRoot {
  dir: string;
  source: SkillSource;
}

export interface ResolvedSkill {
  metadata: SkillMetadata;
  content: string;
  files: Record<string, string>;
}

const SUPPORTED_VERSION = 1;
const FILES_SUBDIRS = ['templates', 'examples', 'workflows'];
// 0.1.87: user roots (`source: 'user'`) re-scan on demand so a style dropped into
// `.claude/skills` while the server runs is visible from the next query — no restart.
// A short window coalesces the burst of registry calls one query makes (PATCH validate,
// GET list, agent-turn has()+resolve()) into a single disk scan. Bundled stays cached
// from startup; plugin styles stay pushed in memory — their cadence is unchanged.
const DEFAULT_USER_RESCAN_TTL_MS = 500;

/** Options for {@link SkillRegistry.load}. */
export interface SkillRegistryOptions {
  /**
   * Coalescing window for the on-demand user-root re-scan, in ms. Within the window
   * repeated reads reuse the last scan instead of touching disk again. `0` disables
   * coalescing (every read re-scans) — used by tests to assert pickup deterministically.
   */
  rescanTtlMs?: number;
}

export class SkillRegistry {
  // Derived merged view (user ∪ bundled ∪ plugin), rebuilt by `rebuild()`. User-root
  // entries are refreshed from disk on demand; bundled/plugin entries are folded in
  // from their caches below.
  private metadataBySlug = new Map<string, SkillMetadata>();
  // Slugs found on disk but dropped during scan (version too high, contextual in a
  // user root, missing/malformed SKILL.md), mapped to a human reason. Lets
  // `unselectableReason()` explain *why* an authored skill isn't selectable instead
  // of just listing what is — see the skip branches in `scanRootInto`. Rebuilt with
  // the merged view.
  private skips = new Map<string, string>();

  // User roots (`source: 'user'`, project before global), retained so each read can
  // re-scan them. Bundled (and any other non-user) roots are scanned once at `load()`
  // into the caches below and never re-read.
  private userRoots: SkillRoot[] = [];
  private bundledBySlug = new Map<string, SkillMetadata>();
  private bundledSkips = new Map<string, string>();
  // M15: plugin-contributed styles carry their body inline (no FS path), so `resolve()`
  // reads them from here instead of disk. `pluginMeta` holds their metadata for the
  // merge; first plugin wins per slug (a later push for the same slug is ignored).
  private pluginMeta = new Map<string, SkillMetadata>();
  private pluginResolved = new Map<string, ResolvedSkill>();

  private rescanTtlMs = DEFAULT_USER_RESCAN_TTL_MS;
  // Epoch (ms) of the last merged-view rebuild; `0` forces a rebuild on next read.
  private lastScanAt = 0;

  /**
   * Build a registry over `roots`. Non-user roots (the in-package bundle) are scanned
   * once here and cached for the registry's life; `source: 'user'` roots are retained
   * and re-scanned on demand by every read (`list`/`listSelectable`/`has`/`isSelectable`/
   * `resolve`/`unselectableReason`), with a short coalescing window — so a style dropped
   * into `.claude/skills` while the server runs is visible from the next query without a
   * restart. An eager warm scan runs here too, so malformed-`SKILL.md` warnings still fire
   * at boot. Merge precedence is unchanged: project > global > plugin > bundled. A missing
   * or unreadable root is treated as empty (no throw); a malformed `SKILL.md` is skipped
   * with a warning; a `scope: contextual` skill in a user root is ignored (package-only).
   */
  static load(roots: SkillRoot[], opts: SkillRegistryOptions = {}): SkillRegistry {
    const registry = new SkillRegistry();
    if (opts.rescanTtlMs !== undefined) registry.rescanTtlMs = opts.rescanTtlMs;
    for (const root of roots) {
      if (root.source === 'user') registry.userRoots.push(root);
      else scanRootInto(root, registry.bundledBySlug, registry.bundledSkips);
    }
    registry.rebuild();
    registry.lastScanAt = Date.now();
    return registry;
  }

  /**
   * Re-scan user roots if the coalescing window has elapsed, then recompute the merged
   * view. Called at the top of every read so a freshly added user style is picked up.
   */
  private ensureFresh(): void {
    const now = Date.now();
    if (now - this.lastScanAt < this.rescanTtlMs) return;
    this.rebuild();
    this.lastScanAt = now;
  }

  /**
   * Recompute the merged view from a fresh user-root scan plus the cached bundled and
   * plugin entries. Precedence (highest first): project user > global user > plugin >
   * bundled — reproduced by merging user first, then bundled, then plugins over the top
   * (a plugin overrides a bundled writing-style but never a user style or a bundled
   * `contextual` skill, preserving contextual resolution).
   */
  private rebuild(): void {
    const meta = new Map<string, SkillMetadata>();
    const skips = new Map<string, string>();

    // 1. User roots — fresh from disk, project before global (first root wins per slug).
    for (const root of this.userRoots) scanRootInto(root, meta, skips);

    // 2. Bundled — cached at load. A valid bundled skill fills an unclaimed slug and
    //    clears any user-root skip for it; bundled's own skips fold in only where no
    //    higher-precedence root claimed or already explained the slug (first skip wins).
    for (const [slug, m] of this.bundledBySlug) {
      if (meta.has(slug)) continue;
      meta.set(slug, m);
      skips.delete(slug);
    }
    for (const [slug, reason] of this.bundledSkips) {
      if (!meta.has(slug) && !skips.has(slug)) skips.set(slug, reason);
    }

    // 3. Plugins — cached pushes. Lose to a user style and never displace a bundled
    //    `contextual` skill; otherwise claim the slug (overriding a bundled writing-style).
    for (const [slug, m] of this.pluginMeta) {
      const existing = meta.get(slug);
      if (existing && (existing.source === 'user' || existing.scope !== 'writing-style')) continue;
      meta.set(slug, m);
      skips.delete(slug);
    }

    this.metadataBySlug = meta;
    this.skips = skips;
  }

  /**
   * M15: push a plugin-contributed writing style. Precedence
   * `project > global > plugin > bundled` is applied at merge time (`rebuild`): a `user`
   * style already claiming this slug wins and the plugin style is dropped; otherwise the
   * plugin style overrides any same-slug `bundled` writing-style. First plugin wins among
   * plugins (a later push for the same slug is ignored here). A plugin never displaces a
   * non-writing-style skill (e.g. a bundled `contextual` skill sharing the slug), so
   * contextual resolution is preserved. Loading is the caller's trust decision — untrusted
   * project-local plugins are never pushed here.
   */
  addPluginStyle(c: WritingStyleContribution): void {
    if (this.pluginMeta.has(c.slug)) return; // first plugin wins
    const metadata: SkillMetadata = {
      slug: c.slug,
      title: c.title,
      description: c.description,
      version: c.version,
      language: c.language,
      scope: 'writing-style',
      source: 'plugin',
      path: '',
    };
    this.pluginMeta.set(c.slug, metadata);
    this.pluginResolved.set(c.slug, { metadata, content: c.content.trimStart(), files: c.files ?? {} });
    this.lastScanAt = 0; // invalidate so the next read rebuilds with this plugin folded in
  }

  list(): SkillMetadata[] {
    this.ensureFresh();
    return Array.from(this.metadataBySlug.values());
  }

  listSelectable(): SkillMetadata[] {
    return this.list().filter((m) => m.scope === 'writing-style');
  }

  /**
   * Explain why `slug` can't be selected as the writing style, for boot/PATCH
   * validation messages. If the slug was found on disk but dropped during scan
   * (version too high, contextual in a user root, malformed), name that reason so
   * the author can fix the skill; otherwise fall back to listing what *is*
   * selectable. Returns a fragment meant to follow `writingStyle "<slug>" `.
   */
  unselectableReason(slug: string): string {
    this.ensureFresh();
    const skip = this.skips.get(slug);
    if (skip !== undefined) return `was found on disk but skipped: ${skip}`;
    const available = this.listSelectable().map((s) => s.slug).join(', ') || '(none)';
    return `not a selectable writing-style skill. Available: ${available}`;
  }

  has(slug: string): boolean {
    this.ensureFresh();
    return this.metadataBySlug.has(slug);
  }

  isSelectable(slug: string): boolean {
    this.ensureFresh();
    const m = this.metadataBySlug.get(slug);
    return m !== undefined && m.scope === 'writing-style';
  }

  resolve(slug: string): ResolvedSkill {
    this.ensureFresh();
    const metadata = this.metadataBySlug.get(slug);
    if (!metadata) throw new Error(`SkillRegistry.resolve: unknown slug "${slug}"`);
    // Plugin styles carry their body inline — no SKILL.md on disk.
    if (metadata.source === 'plugin') {
      const resolved = this.pluginResolved.get(slug);
      if (!resolved) throw new Error(`SkillRegistry.resolve: plugin style "${slug}" has no body`);
      return resolved;
    }
    const skillFile = path.join(metadata.path, 'SKILL.md');
    const raw = fs.readFileSync(skillFile, 'utf8');
    const { content } = matter(raw);
    const files = loadSkillFiles(metadata.path);
    return { metadata, content: content.trimStart(), files };
  }
}

export class SkillResolver {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly cwd: string,
  ) {}

  /**
   * Resolved per query — `readConfig` reads `.claude4spec/config.json` from disk
   * each call, so editing config.json between turns takes effect on the next
   * `POST /api/chat`. Returns `[]` when no style is active or registry doesn't
   * know the slug (defensive — startup validation should catch the latter).
   */
  resolve(): InlineSkill[] {
    const slug = readConfig(this.cwd).writingStyle;
    if (slug === null) return [];
    if (!this.registry.has(slug)) {
      console.warn(`[skill] config.writingStyle="${slug}" not in registry, skipping`);
      return [];
    }
    const skill = this.registry.resolve(slug);
    if (skill.metadata.scope !== 'writing-style') {
      console.warn(`[skill] config.writingStyle="${slug}" has scope="${skill.metadata.scope}", skipping`);
      return [];
    }
    return [{
      name: skill.metadata.slug,
      description: skill.metadata.description,
      content: skill.content,
      files: skill.files,
      metadata: {
        version: skill.metadata.version,
        language: skill.metadata.language,
        title: skill.metadata.title,
      },
    }];
  }
}

export function findSkillsDir(): string {
  // dev: <repo>/src/server/services/skill-registry.ts → ../skills/
  // prod: <repo>/dist/server/services/skill-registry.js → ../skills/
  // build:server kopiuje src/server/skills/ → dist/server/skills/.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'skills');
}

/**
 * Roots to scan for selectable writing styles, highest precedence first:
 * project `<cwd>/.claude/skills` > global `~/.claude/skills` > in-package bundle.
 * Project/global are user-authored (`source: 'user'`); the bundle is `'bundled'`.
 */
export function findSkillsRoots(cwd: string): SkillRoot[] {
  return [
    { dir: path.join(cwd, '.claude', 'skills'), source: 'user' },
    { dir: path.join(os.homedir(), '.claude', 'skills'), source: 'user' },
    { dir: findSkillsDir(), source: 'bundled' },
  ];
}

/** Record a skip reason, first reason winning (matches root precedence — roots are scanned highest first). */
function recordSkip(skips: Map<string, string>, slug: string, reason: string): void {
  if (!skips.has(slug)) skips.set(slug, reason);
}

/**
 * Scan one root into the given `meta`/`skips` maps, deduplicated per slug: a slug already
 * in `meta` (claimed by a higher-precedence root) is left untouched. A missing or unreadable
 * root is treated as empty (no throw); a malformed `SKILL.md` is skipped with a warning and a
 * recorded reason; a `scope: contextual` skill in a `source: 'user'` root is ignored
 * (contextual skills are package-only). A valid skill clears any stale skip for its slug.
 */
function scanRootInto(root: SkillRoot, meta: Map<string, SkillMetadata>, skips: Map<string, string>): void {
  let entries: fs.Dirent[];
  try {
    if (!fs.existsSync(root.dir)) return;
    entries = fs.readdirSync(root.dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[skill] root "${root.dir}" unreadable: ${(err as Error).message}, treating as empty`);
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    // Higher-precedence root already claimed this slug.
    if (meta.has(slug)) continue;
    const skillDir = path.join(root.dir, slug);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      console.warn(`[skill] ${slug}: missing SKILL.md, skipping`);
      recordSkip(skips, slug, 'missing SKILL.md');
      continue;
    }
    try {
      const raw = fs.readFileSync(skillFile, 'utf8');
      const { data } = matter(raw);
      const metadata = parseFrontmatter(slug, skillDir, root.source, data);
      if (metadata.version > SUPPORTED_VERSION) {
        const reason = `version ${metadata.version} > supported ${SUPPORTED_VERSION}`;
        console.warn(`[skill] ${slug}: ${reason}, skipping`);
        recordSkip(skips, slug, reason);
        continue;
      }
      // Contextual skills are package-only: ignore them entirely when dropped
      // into a user root (not selectable, not used for contextual resolution).
      if (metadata.scope === 'contextual' && root.source === 'user') {
        console.warn(`[skill] ${slug}: scope "contextual" in user root, ignored (package-only)`);
        recordSkip(skips, slug, 'scope "contextual" in a user root (contextual skills are package-only)');
        continue;
      }
      meta.set(slug, metadata);
      // A later, lower-precedence root supplied a valid skill for a slug an earlier
      // root had skipped — it's no longer unselectable, so drop the stale reason.
      skips.delete(slug);
    } catch (err) {
      console.warn(`[skill] ${slug}: ${(err as Error).message}, skipping`);
      recordSkip(skips, slug, (err as Error).message);
    }
  }
}

function parseFrontmatter(slug: string, skillPath: string, source: SkillSource, data: Record<string, unknown>): SkillMetadata {
  const title = data.title;
  const description = data.description;
  const version = data.version;
  const language = data.language;
  const scopeRaw = data.scope ?? 'writing-style';
  if (typeof title !== 'string' || title.length === 0) throw new Error("frontmatter 'title' must be a non-empty string");
  if (typeof description !== 'string' || description.length === 0) throw new Error("frontmatter 'description' must be a non-empty string");
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new Error("frontmatter 'version' must be a positive integer");
  if (language !== 'en' && language !== 'pl') throw new Error("frontmatter 'language' must be 'en' or 'pl'");
  if (scopeRaw !== 'writing-style' && scopeRaw !== 'contextual') throw new Error("frontmatter 'scope' must be 'writing-style' or 'contextual'");
  return { slug, title, description, version, language, scope: scopeRaw, source, path: skillPath };
}

function loadSkillFiles(skillDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sub of FILES_SUBDIRS) {
    const subDir = path.join(skillDir, sub);
    if (!fs.existsSync(subDir)) continue;
    walkDir(subDir, sub, out);
  }
  return out;
}

function walkDir(absDir: string, relPrefix: string, out: Record<string, string>): void {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const absChild = path.join(absDir, entry.name);
    const relChild = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      walkDir(absChild, relChild, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const buf = fs.readFileSync(absChild);
    if (!isUtf8Text(buf)) {
      console.warn(`[skill] ${relChild}: not valid UTF-8 text, skipping`);
      continue;
    }
    out[relChild] = buf.toString('utf8');
  }
}

function isUtf8Text(buf: Buffer): boolean {
  // Reject NUL bytes (typical binary signature). Then attempt strict UTF-8 decode.
  for (const byte of buf) if (byte === 0) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}
