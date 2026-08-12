import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { InlineSkill } from '@inharness-ai/agent-adapters';
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
   */
  files: Record<string, string>;
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
    this.pluginResolved.set(c.slug, { metadata, content: c.content.trimStart(), files: c.files ?? {} });
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
 * Maps a resolved skill onto the `InlineSkill` shape the agent adapter expects.
 * `scope` travels in `metadata` so the caller (agent-turn.ts) can pick the active
 * writing style out of the resolved list without a second registry lookup —
 * `scope: 'writing-style'` is the unambiguous signal, and since 0.2.19 the only
 * one that matters: the writing style is the sole skill that earns a
 * `<project_skill>` block, every other skill rides `inlineSkills` alone.
 */
export function toInlineSkill(skill: ResolvedSkill): InlineSkill {
  return {
    name: skill.metadata.slug,
    description: skill.metadata.description,
    content: skill.content,
    files: skill.files,
    metadata: {
      version: skill.metadata.version,
      language: skill.metadata.language,
      title: skill.metadata.title,
      scope: skill.metadata.scope,
    },
  };
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
    return [toInlineSkill(skill)];
  }

  /**
   * M37: per-context-type resolution, called once per agent turn. Since 0.2.19 the
   * result is the union of THREE sources, deduped by slug and ordered:
   *
   *   1. `CONTEXT_TYPE_REGISTRY[contextType].attachInternalSkills` — the hardcoded
   *      contextual slugs. This catalogue is down to a single entry
   *      (`writing-style-author`, chat only); `brief-author` and `patch-implementer`
   *      are gone, and with them the idea that a mode's identity is a skill.
   *   2. NEW — the unconditional plugin fan-out: every `source: 'plugin'`,
   *      `scope: 'contextual'` skill, attached to EVERY context type with no
   *      selection, no config entry and no opt-out. This is now the main producer of
   *      contextual entries.
   *   3. The active writing style (`resolve()`), kept last so it stays the trailing
   *      entry, and the only one the prompt builder gives a `<project_skill>` block.
   *
   * Content is always resolved through `resolve(slug)`, i.e. through the precedence
   * chain `project > global > plugin > bundled`. That is deliberate and is what makes
   * a same-slug user-authored skill override a plugin contextual skill's BODY while
   * leaving the attachment itself intact.
   *
   * An unknown `attachInternalSkills` slug is warned and skipped rather than
   * thrown — even though these slugs come from the code-level
   * `CONTEXT_TYPE_REGISTRY` and every entry is meant to name an always-present
   * package-bundled skill, `SkillRegistry`'s bundled roots are scanned ONCE at
   * server boot and never rescanned (see `load()`/`rebuild()` above). That means
   * there is an inherent window on every real deploy — new code shipped, server
   * not yet restarted — where a newly bundled skill exists on disk but not in
   * the live process's cache. Throwing here would turn that ordinary, transient
   * window into a hard per-request failure for every turn of the affected
   * context type until the process restarts (this happened for real once — a
   * throw here took down every `chat` turn against a dev server started before
   * `writing-style-author` was added). Degrading gracefully and logging is the
   * right tradeoff; a genuinely broken/missing bundled skill is better caught by
   * a startup-time check than by every in-flight request paying for it.
   */
  resolveForContext(contextType: ChatContextType): InlineSkill[] {
    const out: InlineSkill[] = [];
    // The active writing style is resolved FIRST but pushed LAST. Its slug is
    // excluded from the two contextual sources below, because both report their
    // entries as `contextual` and `dedupeBySlug` keeps the first: a style that
    // also appears as a contextual attachment would otherwise be dropped, leaving
    // the turn with no `scope: 'writing-style'` entry and hence no
    // `<project_skill>` block for a style the project did select.
    const style = this.resolve();
    const styleSlugs = new Set(style.map((s) => s.name));
    for (const slug of CONTEXT_TYPE_REGISTRY[contextType].attachInternalSkills) {
      if (styleSlugs.has(slug)) continue;
      if (!this.registry.has(slug)) {
        console.warn(`[skill] attachInternalSkills slug "${slug}" not in registry, skipping`);
        continue;
      }
      // Reported as `contextual` for the same reason the fan-out below does it: a
      // user root may only author `writing-style`-scoped skills, so a user override
      // of a bundled contextual slug carries that scope in its file and would
      // otherwise be mistaken for the active writing style.
      const resolved = this.registry.resolve(slug);
      out.push(toInlineSkill({ ...resolved, metadata: { ...resolved.metadata, scope: 'contextual' } }));
    }
    // Source 2 — the unconditional plugin fan-out. `distinctBySlug` because the
    // contribution list is not deduped; `resolve()` then applies precedence, so what
    // actually reaches the agent may be a user-authored body under the same slug.
    //
    // The resolved entry is reported with `scope: 'contextual'` whatever the winning
    // FILE says. It is here because a plugin contributed it as contextual, and that is
    // what it is in this turn — while a user override of such a slug has to be authored
    // as `scope: writing-style` (a contextual skill in a user root is ignored,
    // package-only). Passing that file's scope through would make the override look
    // like the active writing style to the prompt builder, which would then hand it the
    // one `<project_skill>` slot the user never selected it for.
    for (const meta of distinctBySlug(
      this.registry.listPluginContributions().filter((s) => s.scope === 'contextual'),
    )) {
      if (styleSlugs.has(meta.slug)) continue;
      const resolved = this.registry.resolve(meta.slug);
      out.push(toInlineSkill({ ...resolved, metadata: { ...resolved.metadata, scope: 'contextual' } }));
    }
    out.push(...style);
    return dedupeBySlug(out);
  }
}

/** First entry per slug, order preserved. Applied to registry metadata before resolution. */
export function distinctBySlug(skills: SkillMetadata[]): SkillMetadata[] {
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)));
}

/**
 * First entry per skill name, order preserved. The three sources of
 * `resolveForContext` can legitimately name the same slug — a plugin contextual skill
 * whose slug also sits in `attachInternalSkills`, or a plugin style that is also the
 * active writing style — and handing the adapter the same skill twice is at best waste
 * and at worst a contradictory duplicate in the prompt.
 */
export function dedupeBySlug(skills: InlineSkill[]): InlineSkill[] {
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
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
function loadSkillFiles(skillDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(skillDir)) return out;
  walkDir(skillDir, '', out);
  delete out['SKILL.md'];
  return out;
}

function walkDir(absDir: string, relPrefix: string, out: Record<string, string>): void {
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
