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
    expect('settings' in manifest.contributes).toBe(false);
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

/**
 * 2.1.77 (M52 `3nbgrss4`; pkg `twgy6hnk`, `0n9pjl9k`, `97365qir`) — local skills
 * only, never a project page, and a skill for the other projects of the workspace
 * is a separate Skill project the author sets up by hand. What the agent does is
 * what the skill text instructs, so that text is the observable asserted here.
 */
describe('c4s-plugin-skill-author — local skills only (2.1.77)', () => {
  const c = skill.content;
  /** The section under a `## ` heading, up to the next one. */
  const section = (heading: string) => {
    const at = c.indexOf(`## ${heading}`);
    expect(at, `section ${heading} exists`).toBeGreaterThan(-1);
    const end = c.indexOf('\n## ', at + 3);
    return c.slice(at, end > -1 ? end : undefined);
  };

  it('[ac:ac-skill-author-nie-zapisuje-stron-proje] skill-author does not write project pages — update_skill_file is its only write, no page tool, in a project of any type', () => {
    const rule = section('The one rule about writing');
    expect(rule).toContain('Write every file of a skill package with **`update_skill_file`**');
    expect(rule).toContain('not the page tools (`create_page`, `update_page`, …)');
    expect(rule).toContain('**Never write a page of the project.** No `create_page`, no `update_sections`, no other page tool, in a project of any type');
    expect(rule).toContain("do not read the project's type or its capabilities");
    // No procedure step calls a page tool; every write step is update_skill_file.
    const procedure = section('Procedure');
    expect(procedure).toContain('update_skill_file({ slug, file: "SKILL.md", content, expectedHash: "" })');
    expect(procedure).not.toMatch(/create_page|update_sections|update_page/);
    expect(section('Checklist before you finish')).toContain('no page of the project was created or changed');
    expect(skill.description).toContain('never writes project pages');
  });

  it("[ac:ac-poproszony-o-skill-dla-innych-projekt] asked for a skill for the other projects of the workspace, skill-author points to creating a Skill project by hand and attaching it on the #skills tab", () => {
    const other = section('A skill for the other projects of the workspace');
    expect(other).toContain('What you write is always a **local skill**');
    expect(other).toContain('**create a separate project of type Skill** and attach it');
    expect(other).toContain('They register that project and attach it **themselves**, in the **`#skills` tab of the project settings**');
    expect(other).toContain('You do not create that project, do not attach it and do not write its pages.');
    // The procedure says it first, before the first write.
    const procedure = section('Procedure');
    expect(procedure.indexOf('A skill for the other projects of the workspace')).toBeGreaterThan(-1);
    expect(procedure.indexOf('A skill for the other projects of the workspace')).toBeLessThan(procedure.indexOf('**Create `SKILL.md`.**'));
    expect(skill.description).toContain('a separate project of type Skill, which the author creates and attaches in the #skills settings tab by hand');
  });

  it('the read/hash rule stays in the writing-rules section, not under the Skill-project heading', () => {
    const rule = "Read with **`load_skill_file(slug, file?)`**. Its answer carries the file's `hash`; that hash is what the next write passes as `expectedHash`.";
    expect(section('The one rule about writing')).toContain(rule);
    expect(section('A skill for the other projects of the workspace')).not.toContain('load_skill_file');
  });

  it('writes local skills, in a project of any type', () => {
    expect(c.startsWith('# Skill Author')).toBe(true);
    expect(c).toContain("You are helping the user write a **local skill** of this project");
    expect(skill.description).toContain("Writes the project's local skills");
    expect(skill.description).toContain('in a project of any type');
  });
});
