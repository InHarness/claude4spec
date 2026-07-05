import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveDirAbs, type Config } from '../config.js';
import { mcpJsonPath } from '../mcp/ensure-mcp-json.js';
import type { ProjectRecord } from '../workspace/types.js';
import type { ExternalSkillContext } from './types.js';
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

export type { ExternalSkillContext } from './types.js';

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

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function writeIfChanged(absPath: string, content: string): void {
  if (fs.existsSync(absPath)) {
    const existing = fs.readFileSync(absPath);
    if (sha256(existing) === sha256(content)) return;
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

function migrateLegacyAgentMd(cwd: string): void {
  const agentMd = path.join(cwd, '.claude4spec', 'AGENT.md');
  const newSkill = path.join(
    cwd,
    '.claude4spec',
    'skills',
    'c4s-spec-reader',
    'SKILL.md',
  );
  if (!fs.existsSync(agentMd)) return;
  if (fs.existsSync(newSkill)) return;

  const original = fs.readFileSync(agentMd, 'utf8');
  const header =
    '<!-- DEPRECATED: this file was AGENT.md. It has been replaced by skills in\n' +
    '     .claude4spec/skills/c4s-spec-reader/SKILL.md (and c4s-brief-implementer).\n' +
    '     Safe to delete after your team has upgraded. -->\n\n';
  fs.writeFileSync(agentMd + '.deprecated', header + original, 'utf8');
  fs.unlinkSync(agentMd);
  console.log('Migrated .claude4spec/AGENT.md → external-skills format (M22).');
}

/**
 * `ctx` must already carry the registered project's identity — see
 * `buildExternalSkillContext`. Callers derive it once (after registration)
 * and pass it in, rather than this function re-deriving it via a second
 * registry read (which would reintroduce the 0/1/N ambiguity the CLI resolver
 * already handles once, for no benefit).
 */
export function ensureExternalSkills(cwd: string, ctx: ExternalSkillContext): void {
  migrateLegacyAgentMd(cwd);

  const skillsRoot = path.join(cwd, '.claude4spec', 'skills');
  const specReaderPath = path.join(skillsRoot, 'c4s-spec-reader', 'SKILL.md');
  const briefImplementerPath = path.join(
    skillsRoot,
    'c4s-brief-implementer',
    'SKILL.md',
  );
  const refactorPath = path.join(skillsRoot, 'c4s-refactor', 'SKILL.md');

  writeIfChanged(specReaderPath, renderSpecReaderSkill(ctx));
  writeIfChanged(briefImplementerPath, renderBriefImplementerSkill(ctx));
  writeIfChanged(refactorPath, renderRefactorSkill(ctx));
}
