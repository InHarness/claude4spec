import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  renderSpecReaderSkill,
  renderBriefImplementerSkill,
  renderRefactorSkill,
  buildExternalSkillContext,
  buildExternalSkillsBundle,
  writeFileSet,
  externalSkillsMetadata,
  isSkillSlug,
  ALL_SKILL_SLUGS,
} from './external-skills-service.js';
import type { ExternalSkillContext } from './types.js';
import type { ProjectRecord } from '../workspace/types.js';
import type { Config } from '../config.js';

const SKILL_DIRS = [
  'c4s-spec-reader',
  'c4s-brief-implementer',
  'c4s-refactor',
] as const;

// 0.1.103: identity injected into every generated SKILL.md — see ExternalSkillContext.
const FIXTURE_CTX: ExternalSkillContext = {
  slug: 'my-spec-project',
  workspace: 'default',
  briefsDirAbs: '/abs/my-spec-project/.claude4spec/briefs',
  patchesDirAbs: '/abs/my-spec-project/.claude4spec/patches',
  pagesDirAbs: '/abs/my-spec-project/pages',
  mcpJsonAbs: '/abs/my-spec-project/.claude4spec/mcp.json',
};

describe('renderers', () => {
  it('bake in the injected --project <slug> --workspace <name> identity and abs-path fallbacks', () => {
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
        sidebar: 'accordion',
        briefTarget: false,
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

describe('isSkillSlug / ALL_SKILL_SLUGS', () => {
  it('recognizes exactly the three known slugs', () => {
    expect(ALL_SKILL_SLUGS).toEqual(['spec-reader', 'brief-implementer', 'refactor']);
    for (const slug of ALL_SKILL_SLUGS) expect(isSkillSlug(slug)).toBe(true);
    expect(isSkillSlug('bogus')).toBe(false);
  });
});

describe('externalSkillsMetadata', () => {
  it('returns exactly three entries with no SKILL.md content', () => {
    const meta = externalSkillsMetadata();
    expect(meta).toHaveLength(3);
    expect(meta.map((m) => m.slug).sort()).toEqual(['brief-implementer', 'refactor', 'spec-reader']);
    for (const m of meta) {
      expect(typeof m.name).toBe('string');
      expect(typeof m.description).toBe('string');
    }
  });
});

describe('buildExternalSkillsBundle', () => {
  it('defaults to all three skills, keyed by <dirName>/SKILL.md', () => {
    const bundle = buildExternalSkillsBundle(FIXTURE_CTX);
    expect([...bundle.keys()].sort()).toEqual([
      'c4s-brief-implementer/SKILL.md',
      'c4s-refactor/SKILL.md',
      'c4s-spec-reader/SKILL.md',
    ]);
    expect(bundle.get('c4s-refactor/SKILL.md')).toBe(renderRefactorSkill(FIXTURE_CTX));
  });

  it('narrows to an explicit selection', () => {
    const bundle = buildExternalSkillsBundle(FIXTURE_CTX, ['spec-reader']);
    expect([...bundle.keys()]).toEqual(['c4s-spec-reader/SKILL.md']);
  });

  it('is deterministic for the same ctx', () => {
    const before = buildExternalSkillsBundle(FIXTURE_CTX);
    const after = buildExternalSkillsBundle(FIXTURE_CTX);
    expect([...before.entries()]).toEqual([...after.entries()]);
  });
});

describe('writeFileSet', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skills-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes every entry, creating the target dir lazily', () => {
    const bundle = buildExternalSkillsBundle(FIXTURE_CTX);
    const written = writeFileSet(dir, bundle);
    expect(written).toHaveLength(3);
    for (const d of SKILL_DIRS) {
      expect(fs.existsSync(path.join(dir, d, 'SKILL.md'))).toBe(true);
    }
  });

  it('overwrites unconditionally, no hash-diff', () => {
    writeFileSet(dir, buildExternalSkillsBundle(FIXTURE_CTX));
    const target = path.join(dir, 'c4s-refactor', 'SKILL.md');
    fs.writeFileSync(target, '# hand-edited', 'utf8');
    writeFileSet(dir, buildExternalSkillsBundle(FIXTURE_CTX));
    expect(fs.readFileSync(target, 'utf8')).toBe(renderRefactorSkill(FIXTURE_CTX));
  });

  it('leaves sibling non-SKILL.md files untouched', () => {
    writeFileSet(dir, buildExternalSkillsBundle(FIXTURE_CTX));
    const sibling = path.join(dir, 'c4s-refactor', 'NOTES.md');
    fs.writeFileSync(sibling, 'my own notes', 'utf8');
    writeFileSet(dir, buildExternalSkillsBundle(FIXTURE_CTX));
    expect(fs.readFileSync(sibling, 'utf8')).toBe('my own notes');
  });
});
