import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { skillAuthorSkill as skill } from '../src/skills/skill-author.js';

/**
 * The envelope's shape and the carriage of its one skill. The listing per context
 * type and the write under a blocked file system are asserted end to end in the
 * host suites (`tests/integration/architecture/envelope-delivery-axes.test.ts`,
 * `src/server/routes/agent-turn.test.ts`); what can break HERE is an import that
 * resolved to nothing, a frontmatter block that survived into the body, or a
 * `contextTypes` that quietly widened.
 */
describe('c4s-plugin-skill-author — the envelope', () => {
  it('is single-slot: one skill, no entity type, nothing else', () => {
    expect(manifest.name).toBe('c4s-plugin-skill-author');
    expect(manifest.contributes.entities).toEqual([]);
    expect(manifest.contributes.skills).toEqual([skill]);
    expect(manifest.contributes.subagents).toBeUndefined();
    expect(manifest.contributes.writingStyles).toBeUndefined();
    expect(manifest.contributes.commands).toBeUndefined();
    expect(manifest.contributes.settings).toBeUndefined();
  });

  it('declares a host API range it can be gated against', () => {
    expect(manifest.hostApiVersion).toBe('^2.0.0');
    expect(manifest.engines).toEqual({ node: '>=20' });
  });
});

describe('c4s-plugin-skill-author — the skill it contributes', () => {
  it('is skill-author, contextual, narrowed to chat and patch', () => {
    expect(skill.slug).toBe('skill-author');
    expect(skill.title).toBe('Skill Author');
    expect(skill.version).toBe(1);
    expect(skill.language).toBe('en');
    expect(skill.scope).toBe('contextual');
    // Present-and-equal: omitting the field would mean all four context types.
    expect(skill.contextTypes).toEqual(['chat', 'patch']);
    expect(skill.description).toContain('update_skill_file');
  });

  it('carries the BODY of SKILL.md, with the frontmatter stripped', () => {
    expect(skill.content.startsWith('---')).toBe(false);
    expect(skill.content).not.toContain('scope: contextual\n---');
    expect(skill.content.startsWith('# Skill Author')).toBe(true);
    expect(skill.files).toBeUndefined();
  });

  it('writes only with update_skill_file — never with file or page tools', () => {
    expect(skill.content).toContain('update_skill_file');
    expect(skill.content).toContain('disableDirectFilesystemAccess');
    expect(skill.content).toMatch(/not the built-in file tools \(Write, Edit, Bash\)/);
    expect(skill.content).toMatch(/not the page tools/);
  });
});
