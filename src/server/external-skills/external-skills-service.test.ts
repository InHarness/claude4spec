import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureExternalSkills,
  renderSpecReaderSkill,
  renderBriefImplementerSkill,
  renderRefactorSkill,
  buildExternalSkillContext,
} from './external-skills-service.js';
import type { ExternalSkillContext } from './types.js';
import type { ProjectRecord } from '../workspace/types.js';
import type { Config } from '../config.js';

const SKILL_NAMES = [
  'c4s-spec-reader',
  'c4s-brief-implementer',
  'c4s-refactor',
] as const;

const skillPath = (cwd: string, name: string) =>
  path.join(cwd, '.claude4spec', 'skills', name, 'SKILL.md');

// 0.1.103: identity injected into every generated SKILL.md — see ExternalSkillContext.
const FIXTURE_CTX: ExternalSkillContext = {
  slug: 'my-spec-project',
  workspace: 'default',
  briefsDirAbs: '/abs/my-spec-project/.claude4spec/briefs',
  patchesDirAbs: '/abs/my-spec-project/.claude4spec/patches',
  pagesDirAbs: '/abs/my-spec-project/pages',
  mcpJsonAbs: '/abs/my-spec-project/.claude4spec/mcp.json',
};

describe('externalSkillsService', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skills-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ensureExternalSkills writes all three SKILL.md files', () => {
    ensureExternalSkills(dir, FIXTURE_CTX);
    for (const name of SKILL_NAMES) {
      expect(fs.existsSync(skillPath(dir, name))).toBe(true);
    }
  });

  it('renderers bake in the injected --project <slug> --workspace <name> identity and abs-path fallbacks', () => {
    const outputs = {
      'c4s-spec-reader': renderSpecReaderSkill(FIXTURE_CTX),
      'c4s-brief-implementer': renderBriefImplementerSkill(FIXTURE_CTX),
      'c4s-refactor': renderRefactorSkill(FIXTURE_CTX),
    };
    for (const [name, body] of Object.entries(outputs)) {
      // Quoted: the slug is an unvalidated directory basename (may contain
      // spaces/shell metacharacters), so it's single-quoted in every example.
      expect(body, name).toContain(`--project '${FIXTURE_CTX.slug}' --workspace '${FIXTURE_CTX.workspace}'`);
      // frontmatter description starts with a verb (Read… / Implement… / Detect…)
      const desc = body.match(/^description:\s*(\S+)/m)?.[1];
      expect(desc, `${name} description verb`).toMatch(/^(Read|Implement|Detect)/);
      // the old walk-up/symlink workaround is gone, replaced by PROJECT_SLUG_NOT_FOUND guidance
      expect(body, name).not.toMatch(/walk up the directory tree/);
      expect(body, name).toContain('PROJECT_SLUG_NOT_FOUND');
    }
    expect(outputs['c4s-brief-implementer']).toContain(FIXTURE_CTX.briefsDirAbs);
    expect(outputs['c4s-brief-implementer']).toContain(FIXTURE_CTX.patchesDirAbs);
    expect(outputs['c4s-spec-reader']).toContain(FIXTURE_CTX.mcpJsonAbs);
    expect(outputs['c4s-refactor']).toContain(FIXTURE_CTX.pagesDirAbs);
  });

  it('is idempotent — a second run leaves each file byte-identical and untouched', () => {
    ensureExternalSkills(dir, FIXTURE_CTX);
    const before = SKILL_NAMES.map((n) => ({
      content: fs.readFileSync(skillPath(dir, n)),
      mtimeMs: fs.statSync(skillPath(dir, n)).mtimeMs,
    }));
    ensureExternalSkills(dir, FIXTURE_CTX);
    SKILL_NAMES.forEach((n, i) => {
      expect(fs.readFileSync(skillPath(dir, n)).equals(before[i]!.content)).toBe(true);
      // unchanged content → writeIfChanged early-returns → mtime preserved
      expect(fs.statSync(skillPath(dir, n)).mtimeMs).toBe(before[i]!.mtimeMs);
    });
  });

  it('overwrites a user-edited SKILL.md (hash-diff → full overwrite)', () => {
    ensureExternalSkills(dir, FIXTURE_CTX);
    const target = skillPath(dir, 'c4s-refactor');
    fs.writeFileSync(target, '# hand-edited — should be reverted', 'utf8');
    ensureExternalSkills(dir, FIXTURE_CTX);
    expect(fs.readFileSync(target, 'utf8')).toBe(renderRefactorSkill(FIXTURE_CTX));
  });

  it('leaves sibling non-SKILL.md files untouched (per-file idempotency)', () => {
    ensureExternalSkills(dir, FIXTURE_CTX);
    const sibling = path.join(dir, '.claude4spec', 'skills', 'c4s-refactor', 'NOTES.md');
    fs.writeFileSync(sibling, 'my own notes', 'utf8');
    ensureExternalSkills(dir, FIXTURE_CTX);
    expect(fs.readFileSync(sibling, 'utf8')).toBe('my own notes');
  });

  it('migrates a legacy AGENT.md to AGENT.md.deprecated with a header (M22)', () => {
    const agentMd = path.join(dir, '.claude4spec', 'AGENT.md');
    fs.mkdirSync(path.dirname(agentMd), { recursive: true });
    fs.writeFileSync(agentMd, 'legacy agent instructions', 'utf8');

    ensureExternalSkills(dir, FIXTURE_CTX);

    expect(fs.existsSync(agentMd)).toBe(false);
    const deprecated = fs.readFileSync(agentMd + '.deprecated', 'utf8');
    expect(deprecated).toContain('DEPRECATED');
    expect(deprecated).toContain('c4s-spec-reader/SKILL.md');
    expect(deprecated).toContain('legacy agent instructions');
  });

  it('leaves AGENT.md.deprecated untouched once SKILL.md already exists', () => {
    // First run migrates and creates the spec-reader SKILL.md.
    const agentMd = path.join(dir, '.claude4spec', 'AGENT.md');
    fs.mkdirSync(path.dirname(agentMd), { recursive: true });
    fs.writeFileSync(agentMd, 'legacy', 'utf8');
    ensureExternalSkills(dir, FIXTURE_CTX);
    const firstDeprecated = fs.readFileSync(agentMd + '.deprecated', 'utf8');

    // A stray AGENT.md reappears; SKILL.md now exists → migration must NOT re-fire.
    fs.writeFileSync(agentMd, 'second legacy', 'utf8');
    ensureExternalSkills(dir, FIXTURE_CTX);
    expect(fs.existsSync(agentMd)).toBe(true); // left in place
    expect(fs.readFileSync(agentMd + '.deprecated', 'utf8')).toBe(firstDeprecated);
  });
});

describe('buildExternalSkillContext', () => {
  const project: ProjectRecord = {
    cwd: '/abs/my-spec-project',
    id: 'abc123',
    name: 'my-spec-project',
    addedAt: '2026-01-01T00:00:00.000Z',
  };
  const config: Config = {
    $schemaVersion: 4,
    name: 'my-spec-project',
    roots: [
      {
        id: 'pages',
        name: 'Pages',
        dir: 'pages',
        builtin: true,
        releasable: true,
        sectionIndexed: true,
        referenceValidated: true,
        linkTargets: [],
        sidebar: 'tree',
      },
    ],
    briefsDir: '.claude4spec/briefs',
    patchesDir: '.claude4spec/patches',
    entitiesDir: '.claude4spec/entities',
    writingStyle: null,
    language: null,
    onboardingCompleted: true,
  } as Config;

  it('derives slug from ProjectRecord.name and resolves abs-path fallbacks', () => {
    const ctx = buildExternalSkillContext('/abs/my-spec-project', project, 'default', config);
    expect(ctx.slug).toBe('my-spec-project');
    expect(ctx.workspace).toBe('default');
    expect(ctx.briefsDirAbs).toBe(path.join('/abs/my-spec-project', '.claude4spec', 'briefs'));
    expect(ctx.patchesDirAbs).toBe(path.join('/abs/my-spec-project', '.claude4spec', 'patches'));
    expect(ctx.pagesDirAbs).toBe(path.join('/abs/my-spec-project', 'pages'));
    expect(ctx.mcpJsonAbs).toBe(path.join('/abs/my-spec-project', '.claude4spec', 'mcp.json'));
  });

  it('pagesDirAbs is undefined when config has no builtin pages root', () => {
    const noPages: Config = { ...config, roots: [] };
    const ctx = buildExternalSkillContext('/abs/my-spec-project', project, 'default', noPages);
    expect(ctx.pagesDirAbs).toBeUndefined();
  });
});
