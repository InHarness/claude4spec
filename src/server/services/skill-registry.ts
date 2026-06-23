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

export class SkillRegistry {
  private metadataBySlug = new Map<string, SkillMetadata>();
  // M15: plugin-contributed styles carry their body inline (no FS path),
  // so `resolve()` reads them from here instead of disk.
  private pluginResolved = new Map<string, ResolvedSkill>();

  /**
   * Scan one or more roots once at startup and merge them, deduplicated per slug
   * by precedence: roots earlier in the array win (project > global > bundled).
   * A missing or unreadable root is treated as empty — no throw. A malformed
   * `SKILL.md` is skipped with a warning. Skills declaring `scope: contextual`
   * found in a `source: 'user'` root are ignored entirely (contextual skills are
   * package-only); bundled contextual skills are kept.
   */
  static load(roots: SkillRoot[]): SkillRegistry {
    const registry = new SkillRegistry();
    for (const root of roots) registry.scanRoot(root);
    return registry;
  }

  private scanRoot(root: SkillRoot): void {
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
      if (this.metadataBySlug.has(slug)) continue;
      const skillDir = path.join(root.dir, slug);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) {
        console.warn(`[skill] ${slug}: missing SKILL.md, skipping`);
        continue;
      }
      try {
        const raw = fs.readFileSync(skillFile, 'utf8');
        const { data } = matter(raw);
        const metadata = parseFrontmatter(slug, skillDir, root.source, data);
        if (metadata.version > SUPPORTED_VERSION) {
          console.warn(`[skill] ${slug}: version ${metadata.version} > supported ${SUPPORTED_VERSION}, skipping`);
          continue;
        }
        // Contextual skills are package-only: ignore them entirely when dropped
        // into a user root (not selectable, not used for contextual resolution).
        if (metadata.scope === 'contextual' && root.source === 'user') {
          console.warn(`[skill] ${slug}: scope "contextual" in user root, ignored (package-only)`);
          continue;
        }
        this.metadataBySlug.set(slug, metadata);
      } catch (err) {
        console.warn(`[skill] ${slug}: ${(err as Error).message}, skipping`);
      }
    }
  }

  /**
   * M15: push a plugin-contributed writing style. Precedence
   * `project > global > plugin > bundled`: a `user` style (project/global)
   * already claiming this slug wins and the plugin style is dropped; otherwise
   * the plugin style is registered, overriding any same-slug `bundled` style.
   * First plugin wins among plugins (a later plugin never displaces an earlier
   * one). A plugin never displaces a non-writing-style skill (e.g. a bundled
   * `contextual` skill sharing the slug), so contextual resolution is preserved.
   * Loading is the caller's trust decision — untrusted project-local plugins are
   * never pushed here.
   */
  addPluginStyle(c: WritingStyleContribution): void {
    const existing = this.metadataBySlug.get(c.slug);
    if (
      existing &&
      (existing.source === 'user' || existing.source === 'plugin' || existing.scope !== 'writing-style')
    ) {
      return;
    }
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
    this.metadataBySlug.set(c.slug, metadata);
    this.pluginResolved.set(c.slug, { metadata, content: c.content.trimStart(), files: c.files ?? {} });
  }

  list(): SkillMetadata[] {
    return Array.from(this.metadataBySlug.values());
  }

  listSelectable(): SkillMetadata[] {
    return this.list().filter((m) => m.scope === 'writing-style');
  }

  has(slug: string): boolean {
    return this.metadataBySlug.has(slug);
  }

  isSelectable(slug: string): boolean {
    const m = this.metadataBySlug.get(slug);
    return m !== undefined && m.scope === 'writing-style';
  }

  resolve(slug: string): ResolvedSkill {
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
