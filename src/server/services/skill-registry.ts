import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import type { PluginSkillContribution, WritingStyleContribution } from '../../shared/plugin-host/manifest.js';
import type { ChatContextType } from '../../shared/entities.js';
import { readConfig } from '../config.js';

export type SkillScope = 'writing-style' | 'contextual';

/**
 * 2.1.9 (M37 `zscui1qz`) — the VALUE a source stamps on every entry it delivers
 * and on every read answer. It is not the identity of a registration: the two
 * `.claude/skills` roots are two registrations (`user-project`, `user-global`)
 * sharing the one value `user`.
 *
 * `project-rooted` and `project-exposed` are declared by M52, not by this module —
 * the registry only names them. Until a module registers such a source nothing
 * carries those values.
 */
export type SkillSource = 'user' | 'plugin' | 'project-rooted' | 'project-exposed';

/**
 * A rung of the precedence chain (M37 `aw9kcadc`). The chain is the REGISTRY's
 * order, one per `scope`; a source's declaration cites its rung per admitted
 * scope and never repeats the order.
 */
export type SkillRung = 'project-rooted' | 'user-project' | 'project-exposed' | 'user-global' | 'plugin';

/** Highest rank first. A rung absent from a scope's chain cannot rank there. */
export const SKILL_PRECEDENCE: Readonly<Record<SkillScope, readonly SkillRung[]>> = {
  'writing-style': ['project-rooted', 'user-project', 'project-exposed', 'user-global', 'plugin'],
  contextual: ['plugin', 'project-rooted', 'project-exposed'],
};

/** How a source refreshes its metadata (declaration field `skan`). */
export type SkillScanCadence = 'on-demand' | 'push' | 'live';

/**
 * Why a slug the registry can name resolves to nothing (M37 `vsa4f54s`).
 *
 * - `outside-registry` — "styl spoza rejestru": stated by the registry itself, for
 *   any slug no source delivers and no source reports.
 * - `envelope-not-loaded` — "wkład koperty niezaładowany": reported by the `plugin`
 *   source for the slugs of a package that did not load (skipped by the M33 gate
 *   after its manifest was read) or of a single entry rejected by the loader's
 *   contribution check. The detail (which package, what value) stays in the
 *   loader's warning and in `detail`.
 *
 * The third reason of the specification ("dostawca podpięcia nieosiągalny") is
 * reported by the `project-exposed` source, which is not registered yet.
 */
export type SkillUnresolvedReason = 'outside-registry' | 'envelope-not-loaded';

/** A slug a source knows but does not deliver — always with a reason. */
export interface UnresolvedSkillSlug {
  slug: string;
  reason: Exclude<SkillUnresolvedReason, 'outside-registry'>;
  /** Human detail for messages, e.g. `package "x" was skipped: host API …`. */
  detail?: string;
}

/** What `unresolvedReason(slug)` answers for a slug no source delivers. */
export interface SkillUnresolved {
  slug: string;
  reason: SkillUnresolvedReason;
  detail?: string;
}

export interface SkillMetadata {
  slug: string;
  title: string;
  description: string;
  version: number;
  language: 'en' | 'pl';
  scope: SkillScope;
  /** The `source` value of the registration the entry came from. */
  source: SkillSource;
  /**
   * Reach of a `scope: 'contextual'` entry in context types; `undefined` means all
   * four. Its carrier depends on the source: the envelope declaration (`plugin`),
   * the package frontmatter (`project-rooted`) or the exposure fields
   * (`project-exposed`). The `.claude/skills` roots never deliver it — they do not
   * admit `contextual` at all. Meaningless for a writing style.
   */
  contextTypes?: ChatContextType[];
  /** Absolute package dir; `''` for an in-memory (pushed) entry. */
  path: string;
}

/**
 * A filesystem root scanned by the `user` source. `registration` names which of
 * the two registrations it is — project (`<cwd>/.claude/skills`) or global
 * (`~/.claude/skills`); {@link SkillRegistry.load} defaults the first root to
 * `user-project` and the rest to `user-global`.
 *
 * `source` stays the LITERAL `'user'`: a root on disk is never a plugin push.
 */
export interface SkillRoot {
  dir: string;
  source: 'user';
  registration?: 'user-project' | 'user-global';
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
 * A non-text file SURVIVES the scan with `isText: false` instead of being
 * dropped: "it is in the package, and this channel will not serve it" is what
 * the `NOT_TEXT` refusal needs to be predictable. Its `content` stays empty.
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

/**
 * The resolved winner of a slug (contract `kontrakt-skillregistry-skillmetadata-resolvedskill`).
 *
 * `files` is the WHOLE package except `SKILL.md` and is a structure internal to
 * the registry: it never leaves the process in one piece — `load_skill_file`
 * emits either the manifest (metrics only) or one named subfile.
 */
export interface ResolvedSkill {
  metadata: SkillMetadata;
  /** `SKILL.md` in the form the entry's source reads it (`user`/`plugin`: body without frontmatter). */
  content: string;
  files: Record<string, SkillPackageFile>;
  /**
   * Present only when the source's file read returns one (`project-rooted`). The
   * registry never computes it. ASSUMPTION:dev-0402 — carried here although the
   * contract snippet's `ResolvedSkill` has no such field.
   */
  hash?: string;
}

/** What one scan of a source yields: admitted-or-not entries, plus packages it could not parse. */
export interface SkillSourceScan {
  entries: SkillMetadata[];
  /** Packages found but malformed/unsupported — slug + human reason (diagnostics only). */
  skipped: Array<{ slug: string; reason: string }>;
}

/** The answer of a source's "odczyt pliku" operation. */
export interface SkillFileRead {
  content: string;
  files: Record<string, SkillPackageFile>;
  hash?: string;
}

/**
 * M37 `zscui1qz` — the contract every skill source registers under. The registry
 * knows no carrier; it knows only this declaration and these operations.
 */
export interface SkillSourceRegistration {
  /** Identity of the registration (two registrations may share one `source` value). */
  readonly name: string;
  /** Stamped on `SkillMetadata.source` of every entry and on every read answer. */
  readonly source: SkillSource;
  /** Admission rule: an entry whose `scope` is not listed is ignored with a warning. */
  readonly scopes: readonly SkillScope[];
  /** The rung this source occupies in the chain of each admitted scope. */
  readonly rank: Readonly<Partial<Record<SkillScope, SkillRung>>>;
  /** Declaration only — the owner of the source writes; the registry writes nothing. */
  readonly writable: boolean;
  /** Metadata refresh cadence. */
  readonly scan: SkillScanCadence;
  /** Optional manifest limit: over it `files` is cut and the answer carries `truncated` + hint. No declaration, no limit. */
  readonly manifestLimit?: number;
  /** Current entries of the source. */
  list(): SkillSourceScan;
  /** "Odczyt pliku" — the content in the form a thread may write back, plus an optional `hash`. */
  read(metadata: SkillMetadata): SkillFileRead;
  /** Slugs the source knows but does not deliver, each with its reason. */
  unresolved(): UnresolvedSkillSlug[];
}

/**
 * What the prompt is allowed to know about a skill: its name, what it is for, and
 * where the winning entry came from (M37 `ixkjxpua`). The BODY is fetched on
 * demand through `load_skill_file`.
 */
export interface SkillListingEntry {
  slug: string;
  description: string;
  /** The `source` value of the entry that won the `contextual` chain. */
  origin: SkillSource;
  /**
   * The provider's registry `id` — ONLY when `origin` is `project-exposed` (the
   * address of `ask({ project })`, M31 #13). A seam: no registered source sets it
   * yet; the `project-exposed` source (M52) does. Never a path (M31 #16).
   */
  project?: string;
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
   * Coalescing window for the on-demand re-scan, in ms. `0` disables coalescing
   * (every read re-scans) — used by tests to assert pickup deterministically.
   */
  rescanTtlMs?: number;
}

/** One admitted entry, with the registration it came from and its arrival order. */
interface HeldEntry {
  meta: SkillMetadata;
  reg: SkillSourceRegistration;
  order: number;
}

/** Position of an entry in its scope's chain; Infinity when the source cites no rung there. */
function rankIndex(entry: HeldEntry): number {
  const rung = entry.reg.rank[entry.meta.scope];
  if (rung === undefined) return Number.POSITIVE_INFINITY;
  const i = SKILL_PRECEDENCE[entry.meta.scope].indexOf(rung);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/**
 * The winner among the admitted entries of ONE slug (M37 `aw9kcadc`):
 *   1. a collision across scopes goes to the `contextual` entry;
 *   2. within a scope, the higher rung of that scope's chain wins;
 *   3. a tie on one rung (plugin ↔ plugin) is first-wins by arrival order.
 */
function pickWinner(group: HeldEntry[]): HeldEntry {
  const contextual = group.filter((e) => e.meta.scope === 'contextual');
  const pool = contextual.length > 0 ? contextual : group;
  return [...pool].sort((a, b) => rankIndex(a) - rankIndex(b) || a.order - b.order)[0]!;
}

export class SkillRegistry {
  // Registered sources, in registration order.
  private sources: SkillSourceRegistration[] = [];
  // Every admitted entry of every source — NOT deduplicated (`list()`).
  private entries: HeldEntry[] = [];
  // The winner per slug, by the precedence chain.
  private winners = new Map<string, HeldEntry>();
  // Slugs a source found but could not admit/parse, with a human reason — for
  // `unselectableReason()`. Only for slugs that ended up without a winner.
  private skips = new Map<string, string>();
  // Slugs reported "known, unresolved" by a source, for slugs without a winner.
  private unresolvedBySlug = new Map<string, UnresolvedSkillSlug>();
  // Warnings already emitted — the scan repeats per query, a warning does not.
  private warned = new Set<string>();

  /** The registry's own `plugin` registration (push at `registerPlugin`, M33). */
  private readonly plugin = new PluginSkillSource();

  private rescanTtlMs = DEFAULT_USER_RESCAN_TTL_MS;
  // Epoch (ms) of the last rebuild; `0` forces a rebuild on next read.
  private lastScanAt = 0;

  /**
   * Build a registry with the registry's own sources: one `user` registration per
   * root (project `user-project`, global `user-global` — both admit
   * `writing-style` only, not writable, scanned on demand, read without frontmatter
   * and without `hash`, no manifest limit) and the `plugin` registration (both
   * scopes, not writable, push, read from memory).
   *
   * A missing or unreadable root is treated as empty (no throw); a malformed
   * `SKILL.md` is skipped with a warning; an entry whose `scope` its source does not
   * admit is ignored with a warning.
   */
  static load(roots: SkillRoot[], opts: SkillRegistryOptions = {}): SkillRegistry {
    const registry = new SkillRegistry();
    if (opts.rescanTtlMs !== undefined) registry.rescanTtlMs = opts.rescanTtlMs;
    roots.forEach((root, i) => {
      const rung = root.registration ?? (i === 0 ? 'user-project' : 'user-global');
      // Registration name = identity; a third root (tests only) gets a suffixed name on the global rung.
      const name = root.registration ?? (i < 2 ? rung : `${rung}#${i}`);
      registry.registerSource(new UserRootSkillSource(root.dir, name, rung));
    });
    registry.registerSource(registry.plugin);
    registry.rebuild();
    registry.lastScanAt = Date.now();
    return registry;
  }

  /**
   * Register a source (M37 `zscui1qz`). Other modules (M52: `project-rooted`,
   * `project-exposed`) register theirs here; the registry only names them.
   */
  registerSource(source: SkillSourceRegistration): void {
    if (this.sources.some((s) => s.name === source.name)) {
      throw new Error(`SkillRegistry: a source named "${source.name}" is already registered`);
    }
    for (const scope of source.scopes) {
      const rung = source.rank[scope];
      if (rung === undefined || !SKILL_PRECEDENCE[scope].includes(rung)) {
        throw new Error(
          `SkillRegistry: source "${source.name}" admits scope "${scope}" but cites no rung of its chain`,
        );
      }
    }
    this.sources.push(source);
    this.lastScanAt = 0;
  }

  /** Drop a registration; its entries leave the registry from the next query. */
  unregisterSource(name: string): void {
    this.sources = this.sources.filter((s) => s.name !== name);
    this.lastScanAt = 0;
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(message);
  }

  private ensureFresh(): void {
    const now = Date.now();
    if (now - this.lastScanAt < this.rescanTtlMs) return;
    this.rebuild();
    this.lastScanAt = now;
  }

  /**
   * Recompute every view from the sources: admission by each declaration, then one
   * winner per slug by the chain of its scope. A lower entry losing to a higher one
   * is logged with a warning; so is a writing style losing a cross-scope collision.
   */
  private rebuild(): void {
    const entries: HeldEntry[] = [];
    const skips = new Map<string, string>();
    const reported = new Map<string, UnresolvedSkillSlug>();
    let order = 0;

    for (const reg of this.sources) {
      const scan = reg.list();
      for (const s of scan.skipped) {
        this.warnOnce(`[skill] ${s.slug} (${reg.name}): ${s.reason}, skipping`);
        if (!skips.has(s.slug)) skips.set(s.slug, s.reason);
      }
      for (const meta of scan.entries) {
        if (!reg.scopes.includes(meta.scope)) {
          const reason = `scope "${meta.scope}" is not admitted by source "${reg.name}" (its declaration admits: ${reg.scopes.join(', ')})`;
          this.warnOnce(`[skill] ${meta.slug}: ${reason}, ignored`);
          if (!skips.has(meta.slug)) skips.set(meta.slug, reason);
          continue;
        }
        entries.push({ meta: { ...meta, source: reg.source }, reg, order: order++ });
      }
      for (const u of reg.unresolved()) if (!reported.has(u.slug)) reported.set(u.slug, u);
    }

    const bySlug = new Map<string, HeldEntry[]>();
    for (const e of entries) {
      const group = bySlug.get(e.meta.slug);
      if (group) group.push(e);
      else bySlug.set(e.meta.slug, [e]);
    }
    const winners = new Map<string, HeldEntry>();
    for (const [slug, group] of bySlug) {
      const winner = pickWinner(group);
      winners.set(slug, winner);
      for (const loser of group) {
        if (loser === winner) continue;
        const why =
          loser.meta.scope !== winner.meta.scope
            ? `a "${winner.meta.scope}" entry wins a collision across scopes`
            : rankIndex(loser) === rankIndex(winner)
              ? `same rung "${winner.reg.rank[winner.meta.scope]}", first registered wins`
              : `"${winner.reg.name}" ranks higher in the "${winner.meta.scope}" chain`;
        this.warnOnce(
          `[skill] ${slug}: ${loser.meta.scope} entry of source "${loser.reg.name}" skipped — ${why} (winner: "${winner.reg.name}")`,
        );
      }
    }
    for (const slug of winners.keys()) {
      skips.delete(slug);
      reported.delete(slug);
    }

    this.entries = entries;
    this.winners = winners;
    this.skips = skips;
    this.unresolvedBySlug = reported;
  }

  /**
   * M15/M37: push a plugin-contributed skill of either scope into the `plugin`
   * source. First push wins per slug — a later push for the same slug is ignored
   * here, and the CALLER (the loader) warns, because only it knows which two
   * plugins collided. Loading is the caller's trust decision — untrusted
   * project-local plugins are never pushed here.
   */
  addPluginSkill(c: PluginSkillContribution): void {
    if (this.plugin.push(c)) this.lastScanAt = 0;
  }

  /** M15 sugar: a `WritingStyleContribution` is a `PluginSkillContribution` with `scope: 'writing-style'`. */
  addPluginStyle(c: WritingStyleContribution): void {
    this.addPluginSkill({ ...c, scope: 'writing-style' });
  }

  /**
   * M33 → M37: a slug of an envelope that did not load — a package skipped by the
   * loader's gate after its manifest was read, or a single entry the loader's
   * contribution check rejected. The `plugin` source reports it "known, unresolved"
   * with the reason `envelope-not-loaded`, unless some source delivers the slug.
   */
  addUnloadedPluginSkill(slug: string, detail?: string): void {
    if (this.plugin.noteUnloaded(slug, detail)) this.lastScanAt = 0;
  }

  /** True when this slug was pushed by a plugin (used by the loader's collision warning). */
  hasPluginSkill(slug: string): boolean {
    return this.plugin.has(slug);
  }

  /**
   * Every admitted entry of every source — NOT deduplicated: one slug present in two
   * sources appears twice, differing in `source`. A consumer filtering this must
   * reduce to unique slugs before `resolve()`.
   */
  list(): SkillMetadata[] {
    this.ensureFresh();
    return this.entries.map((e) => e.meta);
  }

  /**
   * Only `scope === 'writing-style'`, deduplicated per slug by precedence: the slugs
   * whose winner is a writing style. A slug lost to a `contextual` entry across
   * scopes is not selectable. Sole source for the M15 surfaces and M01 validation.
   */
  listSelectable(): SkillMetadata[] {
    this.ensureFresh();
    return Array.from(this.winners.values())
      .filter((w) => w.meta.scope === 'writing-style')
      .sort((a, b) => a.order - b.order)
      .map((w) => w.meta);
  }

  has(slug: string): boolean {
    this.ensureFresh();
    return this.winners.has(slug);
  }

  isSelectable(slug: string): boolean {
    this.ensureFresh();
    return this.winners.get(slug)?.meta.scope === 'writing-style';
  }

  /**
   * M37 `vsa4f54s` — `null` when a source delivers the slug; otherwise the reason it
   * is unresolved: the reason a source reported, or `outside-registry`.
   */
  unresolvedReason(slug: string): SkillUnresolved | null {
    this.ensureFresh();
    if (this.winners.has(slug)) return null;
    const reported = this.unresolvedBySlug.get(slug);
    if (reported) return { slug, reason: reported.reason, ...(reported.detail ? { detail: reported.detail } : {}) };
    return { slug, reason: 'outside-registry' };
  }

  /**
   * Explain why `slug` can't be selected as the writing style, for boot/PATCH
   * validation messages. Returns a fragment meant to follow `writingStyle "<slug>" `.
   */
  unselectableReason(slug: string): string {
    this.ensureFresh();
    const unresolved = this.unresolvedReason(slug);
    if (unresolved?.reason === 'envelope-not-loaded') {
      return `is contributed by a plugin package that did not load${unresolved.detail ? ` (${unresolved.detail})` : ''} — fix or reinstall the package, or pick another style`;
    }
    const skip = this.skips.get(slug);
    if (skip !== undefined) return `was found on disk but skipped: ${skip}`;
    const available = this.listSelectable().map((s) => s.slug).join(', ') || '(none)';
    return `not a selectable writing-style skill. Available: ${available}`;
  }

  /**
   * The manifest limit declared by the source of the slug's winner, or `undefined`
   * when that source declares none (M37 `zscui1qz`, `7pj9yx9k`). Read by
   * `load_skill_file` to cut `files`; the registry itself cuts nothing.
   */
  manifestLimitOf(slug: string): number | undefined {
    this.ensureFresh();
    return this.winners.get(slug)?.reg.manifestLimit;
  }

  /** Lazy read of the precedence WINNER through its source's file read. Throws if `!has(slug)`. */
  resolve(slug: string): ResolvedSkill {
    this.ensureFresh();
    const winner = this.winners.get(slug);
    if (!winner) throw new Error(`SkillRegistry.resolve: unknown slug "${slug}"`);
    const read = winner.reg.read(winner.meta);
    return {
      metadata: winner.meta,
      content: read.content,
      files: read.files,
      ...(read.hash !== undefined ? { hash: read.hash } : {}),
    };
  }
}

/**
 * The `user` source, one registration per `.claude/skills` root: admits
 * `writing-style` only, not writable, scanned on demand, read = body without
 * frontmatter, no `hash`, no manifest limit.
 */
class UserRootSkillSource implements SkillSourceRegistration {
  readonly source = 'user' as const;
  readonly scopes = ['writing-style'] as const;
  readonly rank: Readonly<Partial<Record<SkillScope, SkillRung>>>;
  readonly writable = false;
  readonly scan = 'on-demand' as const;

  constructor(
    private readonly dir: string,
    readonly name: string,
    rung: 'user-project' | 'user-global',
  ) {
    this.rank = { 'writing-style': rung };
  }

  list(): SkillSourceScan {
    return scanRoot(this.dir);
  }

  read(metadata: SkillMetadata): SkillFileRead {
    const raw = fs.readFileSync(path.join(metadata.path, 'SKILL.md'), 'utf8');
    const { content } = matter(raw);
    return { content: content.trimStart(), files: loadSkillFiles(metadata.path) };
  }

  unresolved(): UnresolvedSkillSlug[] {
    return [];
  }
}

/**
 * The `plugin` source: both scopes, not writable, push at `registerPlugin` (M33),
 * read from memory (body without frontmatter, no `hash`, no manifest limit).
 * Reports `envelope-not-loaded` for the slugs of envelopes that did not load.
 */
class PluginSkillSource implements SkillSourceRegistration {
  readonly name = 'plugin';
  readonly source = 'plugin' as const;
  readonly scopes = ['writing-style', 'contextual'] as const;
  readonly rank = { 'writing-style': 'plugin', contextual: 'plugin' } as const;
  readonly writable = false;
  readonly scan = 'push' as const;

  private meta = new Map<string, SkillMetadata>();
  private bodies = new Map<string, SkillFileRead>();
  private unloaded = new Map<string, UnresolvedSkillSlug>();

  has(slug: string): boolean {
    return this.meta.has(slug);
  }

  /** First push wins; returns whether the push was taken. */
  push(c: PluginSkillContribution): boolean {
    if (this.meta.has(c.slug)) return false;
    this.meta.set(c.slug, {
      slug: c.slug,
      title: c.title,
      description: c.description,
      version: c.version,
      language: c.language,
      scope: c.scope,
      source: 'plugin',
      // Carried verbatim, `undefined` included — absence means "all four".
      contextTypes: c.contextTypes,
      path: '',
    });
    // A contributed file is text by construction: it is a string in a JS module.
    this.bodies.set(c.slug, { content: c.content.trimStart(), files: toPackageFiles(c.files ?? {}) });
    return true;
  }

  noteUnloaded(slug: string, detail?: string): boolean {
    if (this.unloaded.has(slug)) return false;
    this.unloaded.set(slug, { slug, reason: 'envelope-not-loaded', ...(detail ? { detail } : {}) });
    return true;
  }

  list(): SkillSourceScan {
    return { entries: Array.from(this.meta.values()), skipped: [] };
  }

  read(metadata: SkillMetadata): SkillFileRead {
    const body = this.bodies.get(metadata.slug);
    if (!body) throw new Error(`SkillRegistry.resolve: plugin skill "${metadata.slug}" has no body`);
    return body;
  }

  unresolved(): UnresolvedSkillSlug[] {
    return Array.from(this.unloaded.values()).filter((u) => !this.meta.has(u.slug));
  }
}

/**
 * What `resolveForContext` hands a turn: the listing that becomes
 * `<available_skills>`, and the at-most-one writing style that becomes
 * `<project_writing_skill>`. Separate fields: "what may I open" versus "what is
 * BINDING here".
 */
export interface ContextSkills {
  listing: SkillListingEntry[];
  /** Slug and title only — the decision to use it is already made. */
  writingStyle: { slug: string; title: string } | null;
}

export class SkillResolver {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly cwd: string,
  ) {}

  /**
   * The active writing style's METADATA, or `null`. Resolved per query —
   * `readConfig` reads `.claude4spec/config.json` from disk each call. `null` when
   * no style is active, or the slug is not a selectable style (start-up
   * validation stops a project on the latter; this is the defensive path).
   */
  resolveWritingStyle(slugOverride?: string | null): SkillMetadata | null {
    const slug = slugOverride !== undefined ? slugOverride : readConfig(this.cwd).writingStyle;
    if (slug === null) return null;
    if (!this.registry.has(slug)) {
      console.warn(`[skill] config.writingStyle="${slug}" not in registry, skipping`);
      return null;
    }
    const meta = this.registry.listSelectable().find((m) => m.slug === slug);
    if (!meta) {
      console.warn(`[skill] config.writingStyle="${slug}" resolves to a contextual skill, skipping`);
      return null;
    }
    return meta;
  }

  /**
   * M37 `m37attach`: per-context-type resolution, called once per agent turn.
   *
   *   1. Fan-out of `contextual` skills — the listing. From `list()` take the
   *      `scope: 'contextual'` entries (only sources admitting `contextual` can
   *      hold one), keep those whose `contextTypes` covers this type (omitted =
   *      all four), reduce to unique slugs, and give each slug ONE row taken from
   *      the winner of the `contextual` chain — `origin` included.
   *   2. Writing style — the forced slot, outside the listing.
   *
   * Metadata only: nothing here calls `registry.resolve()`; the body is served by
   * `load_skill_file` against the live registry. The filter narrows DISCOVERY,
   * not ACCESS.
   */
  resolveForContext(contextType: ChatContextType, opts: { writingStyle?: string | null } = {}): ContextSkills {
    return this.resolveListing(contextType, opts.writingStyle);
  }

  /** The same resolution with NO context type: the union of the fan-out over all four. */
  resolveAll(): ContextSkills {
    return this.resolveListing(undefined);
  }

  /** `writingStyle` pins the style a THREAD settled on its first turn; `undefined` = current config. */
  private resolveListing(contextType: ChatContextType | undefined, writingStyle?: string | null): ContextSkills {
    const style = this.resolveWritingStyle(writingStyle);
    const styleSlug = style?.slug;
    const all = this.registry.list();
    const listing: SkillListingEntry[] = [];

    for (const meta of distinctBySlug(
      all.filter(
        (s) =>
          s.scope === 'contextual' &&
          (contextType === undefined || s.contextTypes === undefined || s.contextTypes.includes(contextType)),
      ),
    )) {
      if (meta.slug === styleSlug) continue;
      const winner = winnerOf(all, meta.slug) ?? meta;
      listing.push({ slug: winner.slug, description: winner.description, origin: winner.source });
    }

    return {
      listing: dedupeBySlug(listing),
      writingStyle: style ? { slug: style.slug, title: style.title } : null,
    };
  }
}

/** The `contextual` chain winner among `list()` entries of one slug. */
function winnerOf(all: SkillMetadata[], slug: string): SkillMetadata | undefined {
  const candidates = all.filter((m) => m.slug === slug && m.scope === 'contextual');
  const chain = SKILL_PRECEDENCE.contextual;
  const at = (m: SkillMetadata): number => {
    const i = chain.indexOf(m.source as SkillRung);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  // Stable sort: equal rungs keep `list()` order (first registered / first pushed wins).
  return [...candidates].sort((a, b) => at(a) - at(b))[0];
}

/** First entry per slug, order preserved. Applied to registry metadata before resolution. */
export function distinctBySlug(skills: SkillMetadata[]): SkillMetadata[] {
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)));
}

/** First entry per slug, order preserved — two rows addressing one document would ask the model to choose between a skill and itself. */
export function dedupeBySlug(skills: SkillListingEntry[]): SkillListingEntry[] {
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)));
}

/**
 * The two `user` roots, highest precedence first: project `<cwd>/.claude/skills`
 * (`user-project`) > global `~/.claude/skills` (`user-global`). They admit
 * `scope: 'writing-style'` and nothing else.
 */
export function findSkillsRoots(cwd: string): SkillRoot[] {
  return [
    { dir: path.join(cwd, '.claude', 'skills'), source: 'user', registration: 'user-project' },
    { dir: path.join(os.homedir(), '.claude', 'skills'), source: 'user', registration: 'user-global' },
  ];
}

/**
 * Scan one `.claude/skills` root. A missing or unreadable root is an empty root (no
 * throw); a malformed `SKILL.md`, a missing one or an unsupported `version` is
 * reported in `skipped`. Admission by `scope` is the REGISTRY's job, by the
 * source's declaration — not the scanner's.
 */
function scanRoot(dir: string): SkillSourceScan {
  const out: SkillSourceScan = { entries: [], skipped: [] };
  let dirents: fs.Dirent[];
  try {
    if (!fs.existsSync(dir)) return out;
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[skill] root "${dir}" unreadable: ${(err as Error).message}, treating as empty`);
    return out;
  }
  for (const entry of dirents) {
    // A symlink whose target is a directory counts as a directory (a broken link is skipped).
    const isDir =
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        (() => {
          try {
            return fs.statSync(path.join(dir, entry.name)).isDirectory();
          } catch {
            return false;
          }
        })());
    if (!isDir) continue;
    const slug = entry.name;
    const skillDir = path.join(dir, slug);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      out.skipped.push({ slug, reason: 'missing SKILL.md' });
      continue;
    }
    try {
      const raw = fs.readFileSync(skillFile, 'utf8');
      const { data } = matter(raw);
      const metadata = parseFrontmatter(slug, skillDir, 'user', data);
      if (metadata.version > SUPPORTED_VERSION) {
        out.skipped.push({ slug, reason: `version ${metadata.version} > supported ${SUPPORTED_VERSION}` });
        continue;
      }
      out.entries.push(metadata);
    } catch (err) {
      out.skipped.push({ slug, reason: (err as Error).message });
    }
  }
  return out;
}

function parseFrontmatter(slug: string, skillPath: string, source: SkillSource, data: Record<string, unknown>): SkillMetadata {
  const title = data.title;
  const description = data.description;
  const version = data.version;
  const language = data.language;
  const scopeRaw = data.scope ?? 'writing-style';
  if (typeof title !== 'string' || title.length === 0) throw new Error("frontmatter 'title' must be a non-empty string");
  if (typeof description !== 'string' || description.trim().length === 0) throw new Error("frontmatter 'description' must be a non-empty string");
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new Error("frontmatter 'version' must be a positive integer");
  if (language !== 'en' && language !== 'pl') throw new Error("frontmatter 'language' must be 'en' or 'pl'");
  if (scopeRaw !== 'writing-style' && scopeRaw !== 'contextual') throw new Error("frontmatter 'scope' must be 'writing-style' or 'contextual'");
  // An unknown frontmatter key (e.g. the retired `injection`) is ignored: it must
  // not throw and must not cause the skill to be skipped.
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
