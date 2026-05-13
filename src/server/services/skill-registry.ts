import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { InlineSkill } from '@inharness-ai/agent-adapters';
import { readConfig } from '../config.js';

export type SkillScope = 'writing-style' | 'contextual';

export interface SkillMetadata {
  slug: string;
  title: string;
  description: string;
  version: number;
  language: 'en' | 'pl';
  scope: SkillScope;
  path: string;
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

  static load(skillsDir: string): SkillRegistry {
    const registry = new SkillRegistry();
    if (!fs.existsSync(skillsDir)) return registry;
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name;
      const skillDir = path.join(skillsDir, slug);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) {
        console.warn(`[skill] ${slug}: missing SKILL.md, skipping`);
        continue;
      }
      try {
        const raw = fs.readFileSync(skillFile, 'utf8');
        const { data } = matter(raw);
        const metadata = parseFrontmatter(slug, skillDir, data);
        if (metadata.version > SUPPORTED_VERSION) {
          console.warn(`[skill] ${slug}: version ${metadata.version} > supported ${SUPPORTED_VERSION}, skipping`);
          continue;
        }
        registry.metadataBySlug.set(slug, metadata);
      } catch (err) {
        console.warn(`[skill] ${slug}: ${(err as Error).message}, skipping`);
      }
    }
    return registry;
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

function parseFrontmatter(slug: string, skillPath: string, data: Record<string, unknown>): SkillMetadata {
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
  return { slug, title, description, version, language, scope: scopeRaw, path: skillPath };
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
