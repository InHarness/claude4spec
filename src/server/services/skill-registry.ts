import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import type { PluginSkillContribution, WritingStyleContribution } from '../../shared/plugin-host/manifest.js';
import type { ChatContextType } from '../../shared/entities.js';
import { CONTEXT_TYPE_REGISTRY } from './chat-context.js';
import { readConfig } from '../config.js';

export type SkillScope = 'writing-style' | 'contextual';

/**
 * Where a skill was discovered: a user `.claude/skills` root, or a plugin
 * contribution (M15). Selection precedence is `project > global > plugin` —
 * project/global are both `user` (ordered by root scan), and `plugin` is now LAST
 * in the chain rather than merely above the in-package bundle.
 *
 * 0.2.66 retires the third class, `'bundled'`. The npm package no longer carries a
 * skills root at all: the reference writing style left for
 * `c4s-plugin-layered-vertical-slices` in 0.2.57 and `writing-style-author`, its
 * last inhabitant, left for `c4s-plugin-writing-style-author` here. The host has
 * no skill source of its own any more — every skill is either a file the user
 * wrote or a package's contribution.
 */
export type SkillSource = 'user' | 'plugin';

export interface SkillMetadata {
  slug: string;
  title: string;
  description: string;
  version: number;
  language: 'en' | 'pl';
  scope: SkillScope;
  source: SkillSource;
  /**
   * 0.2.66 — which context types this skill is LISTED in, as declared by the
   * package that contributed it. `undefined` means all four, which is also the
   * only value an FS-scanned entry ever has: the field travels on
   * `PluginSkillContribution` and there is no frontmatter key for it. A writing
   * style ignores it entirely — it reaches a turn through `config.writingStyle`
   * and its own block, not through the listing.
   */
  contextTypes?: ChatContextType[];
  path: string;
}

/**
 * A filesystem root scanned by {@link SkillRegistry.load}. Roots are scanned in
 * array order (highest precedence first); on a slug collision the first root wins,
 * so callers pass project before global. See {@link findSkillsRoots}.
 *
 * `source` is the LITERAL `'user'` rather than `SkillSource`: 0.2.66 left exactly
 * one class of root, and the scanner's admission rule (`scope: contextual` is
 * refused) reads that field to decide. Typing it as the wider union would let
 * `{ dir, source: 'plugin' }` type-check, which stamps disk entries as plugin
 * pushes, silently disables that rule, and sends `resolve()` down the plugin
 * branch to throw "has no body" for a skill that is right there on disk. The
 * field stays because it is what `parseFrontmatter` writes onto each entry.
 */
export interface SkillRoot {
  dir: string;
  source: 'user';
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
// 0.1.87: FS roots re-scan on demand so a style dropped into `.claude/skills` while the
// server runs is visible from the next query — no restart. A short window coalesces the
// burst of registry calls one query makes (PATCH validate, GET list, agent-turn
// has()+resolve()) into a single disk scan. Plugin skills stay pushed in memory — their
// cadence is the loader's, not the scan's.
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
  // Derived merged view (user ∪ plugin), rebuilt by `rebuild()`. FS-root entries are
  // refreshed from disk on demand; plugin entries are folded in from the cache below.
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
  // M15: plugin-contributed skills carry their body inline (no FS path), so `resolve()`
  // reads them from here instead of disk. `pluginMeta` holds their metadata for the
  // merge; first plugin wins per slug (a later push for the same slug is ignored).
  private pluginMeta = new Map<string, SkillMetadata>();
  private pluginResolved = new Map<string, ResolvedSkill>();

  private rescanTtlMs = DEFAULT_USER_RESCAN_TTL_MS;
  // Epoch (ms) of the last merged-view rebuild; `0` forces a rebuild on next read.
  private lastScanAt = 0;

  /**
   * Build a registry over `roots`. Every root is re-scanned on demand by every read
   * (`list`/`listSelectable`/`has`/`isSelectable`/`resolve`/`unselectableReason`), with a
   * short coalescing window — so a style dropped into `.claude/skills` while the server
   * runs is visible from the next query without a restart. An eager warm scan runs here
   * too, so malformed-`SKILL.md` warnings still fire at boot.
   *
   * 0.2.66 — there is no longer a second CADENCE to explain. The in-package root was the
   * only one scanned once and cached for the process's life, which is what made a shipped
   * skill need a restart to appear; with it gone, every root on disk is on-demand and only
   * plugin pushes are held in memory (their cadence being the loader's, not the scan's).
   *
   * Merge precedence: project > global > plugin. A missing or unreadable root is treated as
   * empty (no throw); a malformed `SKILL.md` is skipped with a warning; a `scope: contextual`
   * skill in an FS root is ignored (contextual skills are package-only).
   */
  static load(roots: SkillRoot[], opts: SkillRegistryOptions = {}): SkillRegistry {
    const registry = new SkillRegistry();
    if (opts.rescanTtlMs !== undefined) registry.rescanTtlMs = opts.rescanTtlMs;
    registry.userRoots.push(...roots);
    registry.rebuild();
    registry.lastScanAt = Date.now();
    return registry;
  }

  /**
   * Re-scan the FS roots if the coalescing window has elapsed, then recompute the merged
   * view. Called at the top of every read so a freshly added user style is picked up.
   */
  private ensureFresh(): void {
    const now = Date.now();
    if (now - this.lastScanAt < this.rescanTtlMs) return;
    this.rebuild();
    this.lastScanAt = now;
  }

  /**
   * Recompute the merged view from a fresh FS-root scan plus the cached plugin pushes.
   * Precedence (highest first): project user > global user > plugin — reproduced by
   * merging the roots first and then plugins over the top, where a plugin never
   * displaces a user entry.
   *
   * 0.2.66 removed the middle step. The chain used to end `… > plugin > bundled`, and
   * a plugin entry had a class BENEATH it that it could legitimately override; now it
   * is last, so the only question this loop asks is whether a user already claimed the
   * slug.
   */
  private rebuild(): void {
    const meta = new Map<string, SkillMetadata>();
    const skips = new Map<string, string>();

    // 1. FS roots — fresh from disk, project before global (first root wins per slug).
    for (const root of this.userRoots) scanRootInto(root, meta, skips);

    // 2. Plugins — cached pushes, and now the LAST rung. A plugin never displaces an
    //    FS-root skill (0.2.19: of either scope — a user-authored skill sharing a slug
    //    with a plugin CONTEXTUAL skill is meant to override its content, which is
    //    exactly this branch losing).
    //
    //    0.2.66 dropped the scope-reclassification guard that stood beside it. Its job
    //    was to stop a contextual contribution from taking over a writing-style slug and
    //    dropping it out of `listSelectable()` — the project losing its style to a plugin
    //    it merely installed. Two rules now make that unreachable rather than merely
    //    refused: the FS roots admit `writing-style` only, so any incumbent here is a
    //    style and loses to the guard above anyway, and `addPluginSkill` is first-wins,
    //    so two plugins never both reach this map with one slug. A guard whose condition
    //    can no longer hold is worse than no guard: it reads as a live rule and documents
    //    a collision the design has since made impossible.
    for (const [slug, m] of this.pluginMeta) {
      if (meta.has(slug)) continue;
      meta.set(slug, m);
      skips.delete(slug);
    }

    this.metadataBySlug = meta;
    this.skips = skips;
  }

  /**
   * M15/M37: push a plugin-contributed skill of either scope. Precedence
   * `project > global > plugin` is applied at merge time (`rebuild`): a `user` skill
   * already claiming this slug wins and the plugin skill's content is dropped. First
   * plugin wins among plugins — a later push for the same slug is ignored here, and the CALLER (the
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
      // Carried verbatim, `undefined` included — the resolver reads the absence as
      // "all four" rather than substituting a list here, so the two states stay
      // distinguishable for anyone reading a registry dump.
      contextTypes: c.contextTypes,
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
   * `scope: 'contextual'` is excluded: a contextual skill is not a choice a user makes.
   * It reaches a turn through the `<available_skills>` listing, in whichever context types
   * its package declared. Listing it as "selectable" would offer the user a switch that
   * controls nothing.
   *
   * 0.2.66 — "regardless of `source`" is gone from this sentence because there is only one
   * source it can have: the FS roots refuse contextual entries, so every contextual skill
   * in the registry arrived through `contributes.skills[]`.
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
  /**
   * 0.2.50 — slug and title only. `<project_writing_skill>` briefly rendered the
   * style's own `description`, and no longer does: a description is a blurb that
   * helps a model DECIDE whether to open a skill, and in that block the decision
   * is already made. `<available_skills>` keeps its descriptions, because that
   * is the one place the blurb does its job.
   */
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
   * 0.2.66 cut this from three sources to two, and the one it cut was the hardcoded
   * one. `CONTEXT_TYPE_REGISTRY[contextType].attachInternalSkills` is gone as a
   * concept: the host no longer holds a map of which skills to pin to which turn.
   * What remains:
   *
   *   1. The plugin fan-out — every `source: 'plugin'`, `scope: 'contextual'` skill
   *      whose OWN `contextTypes` admits this turn. Unconditional in the sense that
   *      matters (no config entry, no user opt-in), but no longer indiscriminate:
   *      the package chooses its reach, and omitting the field still means all four.
   *      This is now the SOLE producer of listing rows, which is why a project with
   *      no plugins loaded gets `<available_skills>` with nothing in it — an empty
   *      block, not a fallback.
   *   2. The active writing style — returned SEPARATELY, and deliberately NOT in
   *      `listing`: it is the one skill with a `<project_writing_skill>` block of its
   *      own, and forcing is a property of THAT SLOT rather than of any skill. No
   *      frontmatter key and no contribution field lets a skill force itself; the
   *      "at most one" cardinality is just the slot being singular.
   *
   * None of this calls `registry.resolve()`. The resolver assembles METADATA —
   * `{ slug, description }` — and nothing else. The precedence chain
   * (`project > global > plugin`) still decides which body a slug names, but it
   * decides it later, inside `load_skill_file`, against the LIVE registry rather than
   * against a copy frozen into the first turn's prompt. That is why a skill edited
   * mid-thread takes effect on the next call and not on the next thread.
   *
   * The filter here narrows DISCOVERY, not ACCESS: a skill this turn does not list
   * stays openable by slug through `load_skill_file`, which reads the whole registry.
   */
  resolveForContext(contextType: ChatContextType): ContextSkills {
    const style = this.resolveWritingStyle();
    const listing: SkillListingEntry[] = [];
    // The style is excluded from the fan-out. It has its own block; a duplicate
    // listing row would advertise the one skill that is not optional as though it
    // were.
    const styleSlug = style?.slug;

    for (const meta of distinctBySlug(
      this.registry.listPluginContributions().filter((s) => s.scope === 'contextual'),
    )) {
      if (meta.slug === styleSlug) continue;
      if (meta.contextTypes !== undefined && !meta.contextTypes.includes(contextType)) continue;
      /**
       * The DESCRIPTION comes from the winning entry, not from the contribution.
       *
       * `listPluginContributions()` reports what a plugin pushed; `list()` reports
       * what precedence actually resolved for that slug. Those differ exactly when
       * a user authored a same-slug override — and since the description is now the
       * only thing the model has to decide whether to open the skill, advertising
       * the plugin's while `load_skill_file` serves the user's body would describe
       * one document and hand over another.
       *
       * Note the split: the DESCRIPTION follows precedence, the `contextTypes`
       * filter above does not. Reach is the package's declaration about its own
       * contribution, and a user overriding the body has said nothing about which
       * turns the skill belongs in.
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
 * First entry per slug, order preserved.
 *
 * With `attachInternalSkills` gone there is only one source left to collide with
 * itself, and `distinctBySlug` already guards it upstream — so this is now a belt to
 * that braces. Kept because the invariant it states is the one the prompt depends on:
 * two rows addressing one document ask the model to choose between a skill and
 * itself.
 */
export function dedupeBySlug(skills: SkillListingEntry[]): SkillListingEntry[] {
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)));
}

/**
 * Roots to scan for selectable writing styles, highest precedence first: project
 * `<cwd>/.claude/skills` > global `~/.claude/skills`. Both are user-authored
 * (`source: 'user'`).
 *
 * 0.2.66 — the third root, the one inside the npm package, is gone along with
 * `findSkillsDir()` that located it. Nothing the host ships is a skill on disk any
 * more; what used to live there travels as a plugin envelope's literals. The
 * practical gain is that the two roots left have ONE cadence (on-demand re-scan)
 * instead of two, so "edit a skill, see it next query" is now true of every file the
 * registry reads.
 *
 * These roots admit `scope: 'writing-style'` and nothing else — see `scanRootInto`.
 * A contextual skill reaches the registry only through `contributes.skills[]`.
 */
export function findSkillsRoots(cwd: string): SkillRoot[] {
  return [
    { dir: path.join(cwd, '.claude', 'skills'), source: 'user' },
    { dir: path.join(os.homedir(), '.claude', 'skills'), source: 'user' },
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
 * recorded reason; a `scope: contextual` skill in an FS root is ignored (contextual skills are
 * package-only). A valid skill clears any stale skip for its slug.
 *
 * 0.2.66 states that last rule as the ADMISSION RULE OF FS ROOTS rather than a quirk of the
 * `user` class, now that no other class of root exists. Its practical edge is narrower than
 * "an envelope's contextual skill cannot be shadowed": a `writing-style-author` directory
 * declaring `scope: contextual` is ignored, but the SAME directory declaring `scope:
 * writing-style` is admitted and wins the slug in `rebuild()` — an FS root outranks every
 * plugin push. That is the deliberate 0.2.19 override (a user re-authors a plugin skill's
 * content by slug) and it is unchanged here; what it costs is that the override also
 * re-scopes, so the shadowed contextual skill turns up in `listSelectable()`. The rule this
 * comment states is only about which SCOPE an FS root may introduce, not about who wins.
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
