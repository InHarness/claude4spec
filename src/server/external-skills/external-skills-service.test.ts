import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureExternalSkills,
  renderSpecReaderSkill,
  renderBriefImplementerSkill,
  renderRefactorSkill,
} from './external-skills-service.js';

const SKILL_NAMES = [
  'c4s-spec-reader',
  'c4s-brief-implementer',
  'c4s-refactor',
] as const;

const skillPath = (cwd: string, name: string) =>
  path.join(cwd, '.claude4spec', 'skills', name, 'SKILL.md');

describe('externalSkillsService', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skills-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ensureExternalSkills writes all three SKILL.md files', () => {
    ensureExternalSkills(dir);
    for (const name of SKILL_NAMES) {
      expect(fs.existsSync(skillPath(dir, name))).toBe(true);
    }
  });

  it('renderers produce committable output — no absolute paths, no hardcoded --project/src/', () => {
    const outputs = {
      'c4s-spec-reader': renderSpecReaderSkill(),
      'c4s-brief-implementer': renderBriefImplementerSkill(),
      'c4s-refactor': renderRefactorSkill(),
    };
    for (const [name, body] of Object.entries(outputs)) {
      // no machine-specific absolute paths
      expect(body, name).not.toMatch(/\/Users\//);
      expect(body, name).not.toMatch(/\/home\//);
      // frontmatter description starts with a verb (Read… / Implement… / Detect…)
      const desc = body.match(/^description:\s*(\S+)/m)?.[1];
      expect(desc, `${name} description verb`).toMatch(/^(Read|Implement|Detect)/);
    }
    // the refactor skill must not pin a concrete --project value or an src/ path
    expect(renderRefactorSkill()).not.toMatch(/--project\s+\.?\/?\S*specyfikacja/);
    expect(renderRefactorSkill()).not.toMatch(/\bsrc\//);
  });

  it('is idempotent — a second run leaves each file byte-identical and untouched', () => {
    ensureExternalSkills(dir);
    const before = SKILL_NAMES.map((n) => ({
      content: fs.readFileSync(skillPath(dir, n)),
      mtimeMs: fs.statSync(skillPath(dir, n)).mtimeMs,
    }));
    ensureExternalSkills(dir);
    SKILL_NAMES.forEach((n, i) => {
      expect(fs.readFileSync(skillPath(dir, n)).equals(before[i]!.content)).toBe(true);
      // unchanged content → writeIfChanged early-returns → mtime preserved
      expect(fs.statSync(skillPath(dir, n)).mtimeMs).toBe(before[i]!.mtimeMs);
    });
  });

  it('overwrites a user-edited SKILL.md (hash-diff → full overwrite)', () => {
    ensureExternalSkills(dir);
    const target = skillPath(dir, 'c4s-refactor');
    fs.writeFileSync(target, '# hand-edited — should be reverted', 'utf8');
    ensureExternalSkills(dir);
    expect(fs.readFileSync(target, 'utf8')).toBe(renderRefactorSkill());
  });

  it('leaves sibling non-SKILL.md files untouched (per-file idempotency)', () => {
    ensureExternalSkills(dir);
    const sibling = path.join(dir, '.claude4spec', 'skills', 'c4s-refactor', 'NOTES.md');
    fs.writeFileSync(sibling, 'my own notes', 'utf8');
    ensureExternalSkills(dir);
    expect(fs.readFileSync(sibling, 'utf8')).toBe('my own notes');
  });

  it('migrates a legacy AGENT.md to AGENT.md.deprecated with a header (M22)', () => {
    const agentMd = path.join(dir, '.claude4spec', 'AGENT.md');
    fs.mkdirSync(path.dirname(agentMd), { recursive: true });
    fs.writeFileSync(agentMd, 'legacy agent instructions', 'utf8');

    ensureExternalSkills(dir);

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
    ensureExternalSkills(dir);
    const firstDeprecated = fs.readFileSync(agentMd + '.deprecated', 'utf8');

    // A stray AGENT.md reappears; SKILL.md now exists → migration must NOT re-fire.
    fs.writeFileSync(agentMd, 'second legacy', 'utf8');
    ensureExternalSkills(dir);
    expect(fs.existsSync(agentMd)).toBe(true); // left in place
    expect(fs.readFileSync(agentMd + '.deprecated', 'utf8')).toBe(firstDeprecated);
  });
});
