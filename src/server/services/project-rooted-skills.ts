/**
 * M52 — the `project-rooted` skill source (2.1.9, `q6jr8zoj`, `9j9cxrsr`,
 * `1v62dbhb`; registry contract M37 `zscui1qz`).
 *
 * A skill package is a first-level subdirectory of the project's `skills` root;
 * its slug is the directory name. The package is VALID when its `SKILL.md`
 * header meets the skill-registry header contract (M37 `2k3yrou1`) — with a
 * non-empty `description` and `contextTypes` (when given) inside the context-type
 * enumeration. Validity gates ONLY the registry entry: an invalid package is
 * skipped with a warning, stays editable and versioned (it is a file of the
 * root like any other), and is still served by `load_skill_file` — marked
 * `invalid` with its reason — under a slug no source resolves.
 *
 * The declaration (the registry only names this source, the values are M52's):
 *  - name and `source` value: `project-rooted`;
 *  - admitted scopes: `writing-style` and `contextual` — the author declares the
 *    reach in the header (`scope`, `contextTypes`), the module adds no filter;
 *  - rank: the `project-rooted` rung of both chains (the registry's order);
 *  - writable: yes (the owner writes — a person through the page routes over the
 *    root's facade, the agent through `update_skill_file` on `spec-skill-tools`,
 *    `services/skill-write.ts`, over the same facade);
 *  - scan: on demand — every registry query re-reads the root, so a new package
 *    reaches the listing of the next thread without a restart;
 *  - file read: the RAW `SKILL.md` (frontmatter and tags included) plus the
 *    `hash` of the file on disk — the form and the value a write expects;
 *  - no manifest limit; reports no "known, unresolved" slugs.
 *
 * The root is found by its KIND (`skills`) in the root registry, never by an id,
 * a directory constant or a configuration key (M52 L13 no-hardcode assert).
 * Lifetime: one instance per project context, built with it (M52 L10).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { ChatContextType } from '../../shared/entities.js';
import { rootDirAbs, type RootRegistry } from '../roots/registry.js';
import { isKnownContextType, formatLegalContextTypes } from './chat-context.js';
import {
  SUPPORTED_SKILL_VERSION,
  loadSkillFiles,
  parseSkillFrontmatter,
  type InvalidSkillRead,
  type SkillFileRead,
  type SkillMetadata,
  type SkillRegistry,
  type SkillRung,
  type SkillScope,
  type SkillSourceRegistration,
  type SkillSourceScan,
  type UnresolvedSkillSlug,
} from './skill-registry.js';

/** The root kind whose single root holds the packages (M52 `i5frb6it`). */
export const SKILLS_ROOT_KIND = 'skills' as const;

const ENTRY_FILE = 'SKILL.md';

/** Same digest the page store answers with (`MarkdownFileStore`): sha256, hex, over the raw file. */
function sha256(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf-8').digest('hex');
}

/** One package as the scan sees it: valid (an entry) or invalid (a reason). */
type PackageVerdict =
  | { ok: true; meta: SkillMetadata }
  | { ok: false; reason: string; data?: Record<string, unknown>; raw?: string };

export class ProjectRootedSkillSource implements SkillSourceRegistration {
  readonly name = 'project-rooted';
  readonly source = 'project-rooted' as const;
  readonly scopes: readonly SkillScope[] = ['writing-style', 'contextual'];
  readonly rank: Readonly<Partial<Record<SkillScope, SkillRung>>> = {
    'writing-style': 'project-rooted',
    contextual: 'project-rooted',
  };
  readonly writable = true;
  readonly scan = 'on-demand' as const;

  /** @param dir absolute directory of the project's `skills` root */
  constructor(private readonly dir: string) {}

  list(): SkillSourceScan {
    const out: SkillSourceScan = { entries: [], skipped: [] };
    for (const slug of this.packageDirs()) {
      const verdict = this.inspect(slug);
      if (verdict.ok) out.entries.push(verdict.meta);
      else out.skipped.push({ slug, reason: verdict.reason });
    }
    return out;
  }

  read(metadata: SkillMetadata): SkillFileRead {
    const raw = fs.readFileSync(path.join(metadata.path, ENTRY_FILE), 'utf8');
    return { content: raw, files: loadSkillFiles(metadata.path), hash: sha256(raw) };
  }

  unresolved(): UnresolvedSkillSlug[] {
    return [];
  }

  /**
   * The invalid package under `slug`, if there is one (the registry asks only
   * for a slug no source resolves). `undefined` for a valid package, a missing
   * directory or a slug that is not a package directory name.
   */
  readInvalid(slug: string): InvalidSkillRead | undefined {
    if (!isPackageName(slug)) return undefined;
    const pkgDir = path.join(this.dir, slug);
    if (!isDirectory(pkgDir)) return undefined;
    const verdict = this.inspect(slug);
    if (verdict.ok) return undefined;
    const data = verdict.data ?? {};
    const scope = data.scope ?? (verdict.raw !== undefined ? 'writing-style' : undefined);
    return {
      slug,
      source: this.source,
      invalidReason: verdict.reason,
      ...(typeof data.title === 'string' ? { title: data.title } : {}),
      ...(typeof data.description === 'string' ? { description: data.description } : {}),
      ...(scope === 'writing-style' || scope === 'contextual' ? { scope } : {}),
      ...(verdict.raw !== undefined ? { content: verdict.raw, hash: sha256(verdict.raw) } : {}),
      files: loadSkillFiles(pkgDir),
    };
  }

  /** First-level subdirectories of the root (dot-directories are outside the root's namespace). */
  private packageDirs(): string[] {
    let dirents: fs.Dirent[];
    try {
      if (!fs.existsSync(this.dir)) return [];
      dirents = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[skill] skills root "${this.dir}" unreadable: ${(err as Error).message}, treating as empty`);
      return [];
    }
    return dirents
      .filter((d) => isPackageName(d.name) && (d.isDirectory() || (d.isSymbolicLink() && isDirectory(path.join(this.dir, d.name)))))
      .map((d) => d.name)
      .sort();
  }

  private inspect(slug: string): PackageVerdict {
    const pkgDir = path.join(this.dir, slug);
    const entry = path.join(pkgDir, ENTRY_FILE);
    if (!fs.existsSync(entry)) return { ok: false, reason: `missing ${ENTRY_FILE}` };
    let raw: string;
    try {
      raw = fs.readFileSync(entry, 'utf8');
    } catch (err) {
      return { ok: false, reason: `${ENTRY_FILE} unreadable: ${(err as Error).message}` };
    }
    let data: Record<string, unknown>;
    try {
      data = matter(raw).data as Record<string, unknown>;
    } catch (err) {
      // YAML that does not parse: the raw content (and its hash) stays readable for the owner to fix.
      return { ok: false, reason: `${ENTRY_FILE} frontmatter does not parse: ${(err as Error).message}`, raw };
    }
    try {
      const meta = parseSkillFrontmatter(slug, pkgDir, this.source, data);
      if (meta.version > SUPPORTED_SKILL_VERSION) {
        return { ok: false, reason: `version ${meta.version} > supported ${SUPPORTED_SKILL_VERSION}`, data, raw };
      }
      const contextTypes = parseContextTypes(data.contextTypes);
      return { ok: true, meta: { ...meta, ...(contextTypes !== undefined ? { contextTypes } : {}) } };
    } catch (err) {
      return { ok: false, reason: (err as Error).message, data, raw };
    }
  }
}

/** `contextTypes` from the header: omitted = all four types; otherwise a list inside the enumeration. */
function parseContextTypes(raw: unknown): ChatContextType[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !isKnownContextType(v))) {
    throw new Error(`frontmatter 'contextTypes' must be a list of context types — ${formatLegalContextTypes()}`);
  }
  return raw as ChatContextType[];
}

/** A package directory name: one path segment, not a dot-name. */
function isPackageName(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !name.includes('/') && !name.includes('\\');
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Registers this project's `project-rooted` source on its registry, over the
 * root of kind `skills` found in the root registry. No such root (no kind
 * declares it) → nothing registered.
 */
export function registerProjectRootedSkills(
  skillRegistry: SkillRegistry,
  roots: Pick<RootRegistry, 'byKind'>,
  cwd: string,
): ProjectRootedSkillSource | undefined {
  const root = roots.byKind(SKILLS_ROOT_KIND)[0];
  if (!root) return undefined;
  const source = new ProjectRootedSkillSource(rootDirAbs(cwd, root));
  skillRegistry.registerSource(source);
  return source;
}
