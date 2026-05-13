import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  SPEC_READER_FRONTMATTER,
  SPEC_READER_BODY,
} from './spec-reader-template.js';
import {
  BRIEF_IMPLEMENTER_FRONTMATTER,
  BRIEF_IMPLEMENTER_BODY,
} from './brief-implementer-template.js';

export function renderSpecReaderSkill(): string {
  return SPEC_READER_FRONTMATTER + '\n' + SPEC_READER_BODY;
}

export function renderBriefImplementerSkill(): string {
  return BRIEF_IMPLEMENTER_FRONTMATTER + '\n' + BRIEF_IMPLEMENTER_BODY;
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

export function ensureExternalSkills(cwd: string): void {
  migrateLegacyAgentMd(cwd);

  const skillsRoot = path.join(cwd, '.claude4spec', 'skills');
  const specReaderPath = path.join(skillsRoot, 'c4s-spec-reader', 'SKILL.md');
  const briefImplementerPath = path.join(
    skillsRoot,
    'c4s-brief-implementer',
    'SKILL.md',
  );

  writeIfChanged(specReaderPath, renderSpecReaderSkill());
  writeIfChanged(briefImplementerPath, renderBriefImplementerSkill());
}
