import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { PluginSkillContribution, WritingStyleContribution } from '../../shared/plugin-host/manifest.js';
import type { ChatContextType } from '../../shared/entities.js';
import { CONTEXT_TYPE_REGISTRY } from './chat-context.js';
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

/**
 * One file of a skill package, as the registry holds it in memory.
 *
 * 0.2.36 split what used to be a bare `Record<path, string>` into a record with
 * METRICS, because the package is no longer delivered wholesale — it is served
 * one named file at a time by `load_skill_file`, and the model has to be able to
 * see what a subfile COSTS before it pays for it. `bytes`/`lines` are exactly
 * the manifest that operation emits.
 *
 * A non-text file now SURVIVES the scan with `isText: false` instead of being
 * dropped. The two states are not the same fact: a dropped file is
 * indistinguishable from one the author never wrote, while `isText: false` says
 * "it is in the package, and this channel will not serve it" — which is what the
 * `NOT_TEXT` refusal needs to be predictable rather than surprising. Its
 * `content` stays empty; nothing ever serves the bytes of a binary.
 */
export interface SkillPackageFile {
  /** POSIX-relative to the package dir — the `file` argument of `load_skill_file`. */
  path: string;
  bytes: number;
  /** 0 for a non-text file. */
  lines: number;
  isText: boolean;
  /** '' for a non-text file. */
  content: string;
}

export interface ResolvedSkill {
  metadata: SkillMetadata;
  content: string;
  /**
   * 0.2.19: the WHOLE skill package except `SKILL.md`, keyed by path relative to
   * the skill dir. There is no directory whitelist any more — `templates/`,
   * `examples/` and `workflows/` are examples of what a package may hold, not a
   * closed set. The host does not know a style's directory layout and injects no
   * methodology block of its own; it only knows a skill has `content` and
   * `files`, so anything the style keeps beside `SKILL.md` (notably
   * `workflows/*.md`, the sole home of genre methodology since 0.2.19) has to
   * reach the agent through here.
   *
   * 0.2.36: this structure NEVER LEAVES THE PROCESS IN ONE PIECE. `load_skill_file`
   * emits either the manifest (metrics only) or one named subfile; there is no
   * caller that receives the map. It stopped riding `InlineSkill.files` into a
   * library tmpdir, which is what made the whole package a prompt-budget item.
   */
  files: Record<string, SkillPackageFile>;
}

/**
 * What the prompt is allowed to know about a skill: its name and what it is for.
 *
 * The whole of 0.2.36 in one type. The listing a turn renders is metadata; the
 * BODY is fetched on demand through `load_skill_file`, so a skill costs one line
 * of prompt instead of a whole `SKILL.md` — and the unconditional plugin fan-out
 * stops being a context-budget risk.
 */
export interface SkillListingEntry {
  slug: string;
  description: string;
}

const SUPPORTED_VERSION = 1;
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
  // M15: plugin-contributed skills carry their body inline (no FS path), so `resolve()`
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

    // 3. Plugins — cached pushes. A plugin never displaces a `user` skill (0.2.19: of
    //    either scope — a user-authored skill sharing a slug with a plugin CONTEXTUAL
    //    skill is meant to override its content, which is exactly this branch losing),
    //    but otherwise claims the slug, overriding a same-slug bundled entry.
    //
    //    0.2.19 relaxed the second half of the old guard. It used to skip whenever the
    //    incumbent was not a writing-style, which was written when plugins could only
    //    contribute styles: a plugin entry landing on a bundled `contextual` slug could
    //    then only be an accident. Now that `contributes.skills` carries contextual
    //    skills too, that guard would silently drop a legitimate contribution.
    //
    //    What survives of it is the SCOPE check: an override may replace a bundled
    //    entry's content, never reclassify it. A contextual plugin skill taking over a
    //    bundled writing-style slug would drop that slug out of `listSelectable()` and
    //    make `resolve()` return nothing for a project that has it selected — the
    //    project loses its writing style to a plugin it merely installed.
    for (const [slug, m] of this.pluginMeta) {
      const existing = meta.get(slug);
      if (existing && existing.source === 'user') continue;
      if (existing && existing.scope !== m.scope) {
        console.warn(
          `[skill] plugin skill "${slug}" (${m.scope}) does not override the ${existing.source} skill of the same slug (${existing.scope}) — scopes differ, skipping`
        );
        continue;
      }
      meta.set(slug, m);
      skips.delete(slug);
    }

    this.metadataBySlug = meta;
    this.skips = skips;
  }

  /**
   * M15/M37: push a plugin-contributed skill of either scope. Precedence
   * `project > global > plugin > bundled` is applied at merge time (`rebuild`): a `user`
   * skill already claiming this slug wins and the plugin skill's content is dropped;
   * otherwise the plugin skill overrides any same-slug `bundled` entry. First plugin wins
   * among plugins — a later push for the same slug is ignored here, and the CALLER (the
   * loader) is the one that warns about it, because only the loader knows which two
   * plugins collided. Loading is the caller's trust decision — untrusted project-local
   * plugins are never pushed here.
   *
   * 0.2.19: generalised from `addPluginStyle` when `contributes.skills` arrived. A
   * contextual plugin skill loses its content to a same-slug user skill exactly like a
   * style does — but note it does NOT lose its ATTACHMENT: `resolveForContext` selects by
   * `source === 'plugin' && scope === 'contextual'` off `list()` and then resolves the
   * slug through the precedence chain, so the user body is what reaches the agent.
   */
  addPluginSkill(c: PluginSkillContribution): void {
    if (this.pluginMeta.has(c.slug)) return; // first plugin wins
    const metadata: SkillMetadata = {
      slug: c.slug,
      title: c.title,
      description: c.description,
      version: c.version,
      language: c.language,
      scope: c.scope,
      source: 'plugin',
      path: '',
    };
    this.pluginMeta.set(c.slug, metadata);
    // A plugin contributes `Record<path, string>` (the manifest contract, unchanged
    // — see `PluginSkillContribution`); the registry holds `SkillPackageFile`. A
    // contributed file is text by construction: it is a string in a JS module, so
    // there is no binary case to represent here.
    this.pluginResolved.set(c.slug, {
      metadata,
      content: c.content.trimStart(),
      files: toPackageFiles(c.files ?? {}),
    });
    this.lastScanAt = 0; // invalidate so the next read rebuilds with this plugin folded in
  }

  /**
   * M15 sugar: a `WritingStyleContribution` is a `PluginSkillContribution` with
   * `scope: 'writing-style'` and nothing else. Kept so the older slot keeps working
   * through the identical path — same registry, same entry, same behaviour.
   */
  addPluginStyle(c: WritingStyleContribution): void {
    this.addPluginSkill({ ...c, scope: 'writing-style' });
  }

  /** True when this slug was contributed by a plugin (used by the loader's collision warning). */
  hasPluginSkill(slug: string): boolean {
    return this.pluginMeta.has(slug);
  }

  /**
   * The plugin contributions AS CONTRIBUTED, before the merge.
   *
   * Deliberately not `list().filter(s => s.source === 'plugin')`: the merged view
   * reports one winner per slug, so a plugin contextual skill that a same-slug
   * user skill outranks disappears from it entirely. Attachment and content are
   * two different questions — a user skill overrides the plugin's BODY, it does
   * not un-contribute the skill — and only this list can answer the first one.
   */
  listPluginContributions(): SkillMetadata[] {
    return Array.from(this.pluginMeta.values());
  }

  /**
   * Every known skill, merged view. NOT DEDUPED by slug in the general case: the merged
   * view is keyed by slug, but callers routinely concatenate results from more than one
   * registry read (or from more than one root's worth of contributions), so anything
   * building a skill LIST for a turn must run its own `dedupeBySlug` — see
   * `SkillResolver.resolveForContext`.
   */
  list(): SkillMetadata[] {
    this.ensureFresh();
    return Array.from(this.metadataBySlug.values());
  }

  /**
   * The writing-style selector's catalogue (M15). Serves the selector and nothing else —
   * it has no say over which skills are loaded into a thread.
   *
   * `scope: 'contextual'` is excluded regardless of `source`: a contextual skill is not a
   * choice a user makes. A bundled one is attached by the context-type registry; a
   * plugin-contributed one is attached unconditionally to all four context types. Listing
   * either as "selectable" would offer the user a switch that controls nothing.
   */
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

/**
 * `toInlineSkill` lived here until 0.2.36.
 *
 * It existed to hand the adapter a whole skill package per turn. Nothing does
 * that any more: the prompt names skills (`SkillListingEntry`) and
 * `load_skill_file` serves their content, so there is no `InlineSkill` left to
 * build. Recorded rather than silently deleted because its absence is the
 * release — a re-appearing converter would be the materialization channel coming
 * back.
 */

/**
 * What `resolveForContext` hands a turn: the listing that becomes
 * `<available_skills>`, and the at-most-one writing style that becomes
 * `<project_skill>`.
 *
 * They are separate fields rather than one list with a flag because they answer
 * different questions — "what may I open" versus "what is BINDING here" — and the
 * writing style is deliberately absent from `listing`: it already has a block of
 * its own that says considerably more than a listing row would.
 */
export interface ContextSkills {
  listing: SkillListingEntry[];
  writingStyle: { slug: string; title: string } | null;
}

export class SkillResolver {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly cwd: string,
  ) {}

  /**
   * The active writing style's METADATA, or `null`.
   *
   * Resolved per query — `readConfig` reads `.claude4spec/config.json` from disk
   * each call, so editing config.json between turns takes effect on the next
   * `POST /api/chat`. Returns `null` when no style is active or the registry
   * doesn't know the slug (defensive — startup validation should catch the latter).
   *
   * 0.2.36: metadata, not content. It used to return `InlineSkill[]` — a
   * one-element list carrying the whole `SKILL.md` and every package file — for a
   * caller that read two fields off it. The body now arrives through
   * `load_skill_file`, so loading it here would be a per-turn disk read nobody
   * consumes.
   */
  resolveWritingStyle(): SkillMetadata | null {
    const slug = readConfig(this.cwd).writingStyle;
    if (slug === null) return null;
    if (!this.registry.has(slug)) {
      console.warn(`[skill] config.writingStyle="${slug}" not in registry, skipping`);
      return null;
    }
    const meta = this.registry.list().find((m) => m.slug === slug);
    if (!meta) return null;
    if (meta.scope !== 'writing-style') {
      console.warn(`[skill] config.writingStyle="${slug}" has scope="${meta.scope}", skipping`);
      return null;
    }
    return meta;
  }

  /**
   * M37: per-context-type resolution, called once per agent turn.
   *
   * 0.2.36 changed WHAT this produces, not where it looks. The three sources are
   * unchanged:
   *
   *   1. `CONTEXT_TYPE_REGISTRY[contextType].attachInternalSkills` — the hardcoded
   *      contextual slugs. This catalogue is down to a single entry
   *      (`writing-style-author`, chat only); `brief-author` and `patch-implementer`
   *      are gone, and with them the idea that a mode's identity is a skill.
   *   2. The unconditional plugin fan-out: every `source: 'plugin'`,
   *      `scope: 'contextual'` skill, attached to EVERY context type with no
   *      selection, no config entry and no opt-out. This is the main producer of
   *      contextual entries.
   *   3. The active writing style — returned SEPARATELY, and deliberately NOT in
   *      `listing`: it is the one skill with a `<project_skill>` block of its own.
   *
   * What changed is that none of this calls `registry.resolve()` any more. The
   * resolver assembles METADATA — `{ slug, description }` — and nothing else. The
   * precedence chain (`project > global > plugin > bundled`) still decides which
   * body a slug names, but it decides it later, inside `load_skill_file`, against
   * the LIVE registry rather than against a copy frozen into the first turn's
   * prompt. That is why a skill edited mid-thread takes effect on the next call
   * and not on the next thread.
   *
   * The scope-normalization the old version did (reporting every contextual entry
   * as `scope: 'contextual'` whatever its file said, so a user override could not
   * be mistaken for the active style) is no longer needed: `listing` carries no
   * scope at all, and the style travels in its own field where it cannot be
   * confused with anything.
   *
   * An unknown `attachInternalSkills` slug is warned and skipped rather than
   * thrown — the bundled roots are scanned ONCE at boot, so on every real deploy
   * there is a window (new code shipped, server not yet restarted) where a newly
   * bundled skill exists on disk but not in the live process's cache. Throwing
   * would turn that transient window into a hard per-request failure for every
   * turn of the affected context type until restart (this happened for real once).
   */
  resolveForContext(contextType: ChatContextType): ContextSkills {
    const style = this.resolveWritingStyle();
    const listing: SkillListingEntry[] = [];
    // The style is excluded from both contextual sources. It has its own block;
    // a duplicate listing row would advertise the one skill that is not optional
    // as though it were.
    const styleSlug = style?.slug;

    for (const slug of CONTEXT_TYPE_REGISTRY[contextType].attachInternalSkills) {
      if (slug === styleSlug) continue;
      const meta = this.registry.list().find((m) => m.slug === slug);
      if (!meta) {
        console.warn(`[skill] attachInternalSkills slug "${slug}" not in registry, skipping`);
        continue;
      }
      listing.push({ slug: meta.slug, description: meta.description });
    }

    for (const meta of distinctBySlug(
      this.registry.listPluginContributions().filter((s) => s.scope === 'contextual'),
    )) {
      if (meta.slug === styleSlug) continue;
      /**
       * The DESCRIPTION comes from the winning entry, not from the contribution.
       *
       * `listPluginContributions()` reports what a plugin pushed; `list()` reports
       * what precedence actually resolved for that slug. Those differ exactly when
       * a user authored a same-slug override — and since the description is now the
       * only thing the model has to decide whether to open the skill, advertising
       * the plugin's while `load_skill_file` serves the user's body would describe
       * one document and hand over another.
       */
      const winning = this.registry.list().find((m) => m.slug === meta.slug) ?? meta;
      listing.push({ slug: winning.slug, description: winning.description });
    }

    return {
      listing: dedupeBySlug(listing),
      writingStyle: style ? { slug: style.slug, title: style.title } : null,
    };
  }
}

/** First entry per slug, order preserved. Applied to registry metadata before resolution. */
export function distinctBySlug(skills: SkillMetadata[]): SkillMetadata[] {
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)));
}

/**
 * First entry per slug, order preserved. The contextual sources of
 * `resolveForContext` can legitimately name the same slug — a plugin contextual skill
 * whose slug also sits in `attachInternalSkills` — and listing it twice would offer
 * the model two rows addressing one document.
 */
export function dedupeBySlug(skills: SkillListingEntry[]): SkillListingEntry[] {
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)));
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
    // A symlink whose target is a directory counts as a directory: a symlinked style dir
    // dropped into `.claude/skills` must be discoverable exactly like a real dir (it is
    // already editable via the config content-root path). `entry.isDirectory()` is false
    // for a symlink even when the target is a dir, so resolve it with `statSync`, guarded
    // so a broken link is skipped rather than throwing.
    const isDir =
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        (() => {
          try {
            return fs.statSync(path.join(root.dir, entry.name)).isDirectory();
          } catch {
            return false; // broken symlink → skip
          }
        })());
    if (!isDir) continue;
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
  // 0.2.19: `injection` is gone from the vocabulary — forcing is a property of the
  // writing-style SLOT, not of a skill. A legacy `injection:` key (any value) is
  // ignored like any other unknown frontmatter field: it must not throw and must
  // not cause the skill to be skipped, or upgrading the host would silently
  // unselect every style authored against the old frontmatter.
  return { slug, title, description, version, language, scope: scopeRaw, source, path: skillPath };
}

/**
 * Every file in the skill package except the root `SKILL.md` (whose body travels
 * as `content` and whose frontmatter is metadata).
 *
 * 0.2.19 dropped the `['templates','examples','workflows']` whitelist. It was a
 * closed set standing in for an open one: a style is free to keep its material
 * wherever it likes, and the host has no way to know which directory names it
 * chose. The whitelist meant a file the author put in `reference/` reached the
 * model as nothing at all — silently, with the skill still loading — which is
 * exactly the failure mode that matters now that `workflows/*.md` carries all
 * genre methodology.
 *
 * Open, but not unbounded: the walk skips dot-directories and `node_modules`,
 * and drops any file over `MAX_SKILL_FILE_BYTES`. Those are not skill material —
 * they are a checked-out `.git`, an installed dependency tree or a data file
 * parked next to the prose — and every one of them would otherwise be read and
 * inlined into the prompt on EVERY turn, since `resolve()` runs per turn.
 */
const MAX_SKILL_FILE_BYTES = 256 * 1024;
const SKIPPED_DIRS = new Set(['node_modules']);
function loadSkillFiles(skillDir: string): Record<string, SkillPackageFile> {
  const out: Record<string, SkillPackageFile> = {};
  if (!fs.existsSync(skillDir)) return out;
  walkDir(skillDir, '', out);
  delete out['SKILL.md'];
  return out;
}

/** The in-memory record for one package file. Kept next to the loader so the plugin
 *  path (`addPluginSkill`) and the disk path cannot disagree about the shape. */
export function toPackageFiles(files: Record<string, string>): Record<string, SkillPackageFile> {
  const out: Record<string, SkillPackageFile> = {};
  for (const [rel, content] of Object.entries(files)) {
    out[rel] = {
      path: rel,
      bytes: Buffer.byteLength(content, 'utf8'),
      lines: countLines(content),
      isText: true,
      content,
    };
  }
  return out;
}

/** Lines as a reader counts them: a trailing newline does not open a further line. */
function countLines(content: string): number {
  if (content === '') return 0;
  const n = content.split('\n').length;
  return content.endsWith('\n') ? n - 1 : n;
}

function walkDir(absDir: string, relPrefix: string, out: Record<string, SkillPackageFile>): void {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const absChild = path.join(absDir, entry.name);
    const relChild = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      walkDir(absChild, relChild, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (fs.statSync(absChild).size > MAX_SKILL_FILE_BYTES) {
      console.warn(`[skill] ${relChild}: larger than ${MAX_SKILL_FILE_BYTES} bytes, skipping`);
      continue;
    }
    const buf = fs.readFileSync(absChild);
    /**
     * 0.2.36: a binary file is RECORDED, not dropped.
     *
     * It used to vanish with a console warn, which made "this skill has no
     * `diagram.png`" and "this channel will not serve you `diagram.png`" the same
     * observation from the model's side. Now it appears in the manifest with
     * `isText: false` and a `load_skill_file` against it refuses with `NOT_TEXT` —
     * a refusal the model could see coming. The content is never read into memory
     * for these: nothing serves it.
     */
    if (!isUtf8Text(buf)) {
      out[relChild] = { path: relChild, bytes: buf.byteLength, lines: 0, isText: false, content: '' };
      continue;
    }
    const content = buf.toString('utf8');
    out[relChild] = {
      path: relChild,
      bytes: buf.byteLength,
      lines: countLines(content),
      isText: true,
      content,
    };
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
