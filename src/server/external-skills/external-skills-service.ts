import fs from 'node:fs';
import path from 'node:path';
import { resolveDirAbs, type Config } from '../config.js';
import { mcpJsonPath } from '../mcp/ensure-mcp-json.js';
import type { ProjectRecord } from '../workspace/types.js';
import type { ExternalSkillContext, ExternalSkillSummary, FileSet, SkillSlug } from './types.js';
import {
  SPEC_READER_FRONTMATTER,
  specReaderBody,
} from './spec-reader-template.js';
import {
  BRIEF_IMPLEMENTER_FRONTMATTER,
  briefImplementerBody,
} from './brief-implementer-template.js';
import {
  REFACTOR_FRONTMATTER,
  refactorBody,
} from './refactor-template.js';

export type { ExternalSkillContext, ExternalSkillSummary, FileSet, SkillSlug } from './types.js';

/**
 * 0.1.103 M22 — assembles the injected identity + abs-path fallbacks the
 * renderers below bake into each generated SKILL.md. Must be called AFTER
 * `registry.registerProject(...)` (the `project.name` — reused as the
 * "slug" identity — only exists once registered).
 */
export function buildExternalSkillContext(
  cwd: string,
  project: ProjectRecord,
  workspaceName: string,
  config: Config,
): ExternalSkillContext {
  const pagesRoot = config.roots.find((r) => r.id === 'pages');
  return {
    slug: project.name,
    workspace: workspaceName,
    briefsDirAbs: resolveDirAbs(cwd, config.briefsDir, 'briefsDir'),
    patchesDirAbs: resolveDirAbs(cwd, config.patchesDir, 'patchesDir'),
    pagesDirAbs: pagesRoot ? path.resolve(cwd, pagesRoot.dir) : undefined,
    mcpJsonAbs: mcpJsonPath(cwd),
  };
}

export function renderSpecReaderSkill(ctx: ExternalSkillContext): string {
  return SPEC_READER_FRONTMATTER + '\n' + specReaderBody(ctx);
}

export function renderBriefImplementerSkill(ctx: ExternalSkillContext): string {
  return BRIEF_IMPLEMENTER_FRONTMATTER + '\n' + briefImplementerBody(ctx);
}

export function renderRefactorSkill(ctx: ExternalSkillContext): string {
  return REFACTOR_FRONTMATTER + '\n' + refactorBody(ctx);
}

interface SkillMeta {
  slug: SkillSlug;
  dirName: string;
  name: string;
  description: string;
  render: (ctx: ExternalSkillContext) => string;
}

// 0.1.104 M22 — short, UI-facing descriptions (distinct from each SKILL.md's
// own long frontmatter `description:`, which is written for Claude's own
// skill-discovery, not for a Settings-page card).
const SKILL_META: SkillMeta[] = [
  {
    slug: 'spec-reader',
    dirName: 'c4s-spec-reader',
    name: 'c4s-spec-reader',
    description: 'Read spec entities (XML tags, c4s CLI/MCP) from a foreign code repo.',
    render: renderSpecReaderSkill,
  },
  {
    slug: 'brief-implementer',
    dirName: 'c4s-brief-implementer',
    name: 'c4s-brief-implementer',
    description: 'Implement M21 briefs in a code repo with a patches feedback loop.',
    render: renderBriefImplementerSkill,
  },
  {
    slug: 'refactor',
    dirName: 'c4s-refactor',
    name: 'c4s-refactor',
    description: 'Drift-router spec↔code for a given topic (hard dependency on c4s + running server).',
    render: renderRefactorSkill,
  },
];

export const ALL_SKILL_SLUGS: SkillSlug[] = SKILL_META.map((m) => m.slug);

export function isSkillSlug(x: string): x is SkillSlug {
  return (ALL_SKILL_SLUGS as string[]).includes(x);
}

/** Static metadata for `GET /api/external-skills` — no `ExternalSkillContext` needed. */
export function externalSkillsMetadata(): ExternalSkillSummary[] {
  return SKILL_META.map(({ slug, name, description }) => ({ slug, name, description }));
}

/**
 * 0.1.104 M22 — pure content builder shared by `c4s install-skills` (CLI,
 * writes to disk) and `GET /api/external-skills/bundle` (HTTP, packs into a
 * ZIP in memory). No disk writes, no side effects — replaces the old
 * `ensureExternalSkills` bootstrap hook, which wrote unconditionally into
 * `.claude4spec/skills/` on every project activation/config change.
 */
export function buildExternalSkillsBundle(ctx: ExternalSkillContext, selection?: SkillSlug[]): FileSet {
  const wanted = selection && selection.length > 0 ? new Set(selection) : new Set(ALL_SKILL_SLUGS);
  const files: FileSet = new Map();
  for (const meta of SKILL_META) {
    if (!wanted.has(meta.slug)) continue;
    files.set(`${meta.dirName}/SKILL.md`, meta.render(ctx));
  }
  return files;
}

/**
 * Writes a `FileSet` to disk under `targetDir`, overwriting unconditionally
 * (no hash-diff, no managed-zone markers — `c4s install-skills` is a one-shot
 * on-demand export, not a bootstrap-time sync). Creates `targetDir` lazily.
 * Returns the absolute paths written.
 */
export function writeFileSet(targetDir: string, files: FileSet): string[] {
  const written: string[] = [];
  for (const [relPath, content] of files) {
    const abs = path.join(targetDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    written.push(abs);
  }
  return written;
}
