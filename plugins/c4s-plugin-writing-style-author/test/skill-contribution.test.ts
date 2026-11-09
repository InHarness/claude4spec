import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { writingStyleAuthorSkill as skill } from '../src/skills/writing-style-author.js';

/**
 * The skill travels as a LITERAL compiled into this module — a `?raw` import Vite
 * inlines at build time — rather than as a file the host reads lazily off a package
 * root. These tests are about that carriage and about the envelope's shape, not
 * about the prose: what can break here is an import that resolved to nothing, a
 * frontmatter block that survived into the body, or a `contextTypes` that quietly
 * widened.
 */
describe('c4s-plugin-writing-style-author — the envelope', () => {
  it('is single-slot: one skill, no entity type, nothing else', () => {
    expect(manifest.name).toBe('c4s-plugin-writing-style-author');
    expect(manifest.contributes.entities).toEqual([]);
    expect(manifest.contributes.skills).toEqual([skill]);
    // The absences are the point of the package, so they are asserted rather than
    // assumed: a `backend`-bearing slot or a subagent here would make it something
    // other than the one-capability envelope it is meant to be.
    expect(manifest.contributes.subagents).toBeUndefined();
    expect(manifest.contributes.writingStyles).toBeUndefined();
    expect(manifest.contributes.commands).toBeUndefined();
    expect('settings' in manifest.contributes).toBe(false);
  });

  it('declares a host API range it can actually be gated against', () => {
    expect(manifest.hostApiVersion).toBe('^2.0.0');
    expect(manifest.engines).toEqual({ node: '>=20' });
  });
});

describe('c4s-plugin-writing-style-author — the skill it contributes', () => {
  it('is the scaffold, at the slug the host used to bundle', () => {
    expect(skill.slug).toBe('writing-style-author');
    expect(skill.title).toBe('Writing Style Author');
    expect(skill.version).toBe(1);
    expect(skill.language).toBe('en');
    expect(skill.description.length).toBeGreaterThan(40);
  });

  it('is CONTEXTUAL, so it is listed and never offered as a style to select', () => {
    // A `writing-style` scope here would put the authoring tool into the settings
    // dropdown as though a project could be written IN it.
    expect(skill.scope).toBe('contextual');
  });

  /**
   * The narrowing is ACTIVE, and the assertion says so: omitting the field would
   * mean all four context types, so `['chat']` present-and-equal is the whole
   * difference between "we chose chat" and "we forgot".
   */
  it('narrows itself to chat, deliberately rather than by default', () => {
    expect(skill.contextTypes).toEqual(['chat']);
  });

  it('carries the BODY of SKILL.md, with the frontmatter stripped', () => {
    // The metadata above is the contribution's own; a frontmatter block reaching the
    // body would be rendered to the agent as if it were prose.
    expect(skill.content.startsWith('---')).toBe(false);
    // Line-anchored: the prose itself names `scope: contextual` (the genre boundary
    // sends such packages to `skill-author`), so only a frontmatter LINE is a leak.
    expect(skill.content).not.toMatch(/^scope: contextual$/m);
    expect(skill.content).not.toMatch(/^title: Writing Style Author$/m);
    expect(skill.content.startsWith('# Writing Style Author')).toBe(true);
    expect(skill.content.length).toBeGreaterThan(1000);
  });

  it('carries no package files — the workflows/ it talks about are its OUTPUT', () => {
    // The instruction tells the agent to WRITE a `workflows/` directory into the
    // style it scaffolds. Giving this contribution one of its own would be a
    // different document, and would read as the scaffold's own methodology.
    expect(skill.files).toBeUndefined();
    expect(skill.content).toContain('workflows/');
  });

  it('still carries the form clause the scaffold must emit verbatim', () => {
    // Guarded in full by `tests/integration/architecture/scaffold-form-clause.test.ts`;
    // this is the package-local tripwire for the import having gone empty.
    expect(skill.content).toContain('**Form clause.**');
  });
});

/**
 * 2.1.9 (pkg `c4s-plugin-writing-style-author` `vt1nmnwx`, M15 `m15wsauth`) — the
 * genre boundary and the write channel, as the skill instructs them.
 */
describe('c4s-plugin-writing-style-author — what the scaffold may write (2.1.9)', () => {
  it('[ac:ac-skill-writing-style-author-poproszony] asked for a skill package that is not a writing style, the skill sends the request to skill-author and does not scaffold', () => {
    const boundary = /\*\*Writing styles only\.\*\*([^\n]*)/.exec(skill.content)?.[1] ?? '';
    expect(boundary).toContain('scope: writing-style');
    expect(boundary).toContain('do not scaffold it here');
    expect(boundary).toContain('`skill-author` skill');
    expect(boundary).toContain('load_skill_file("skill-author")');
    // The first step of the workflow checks the genre before anything is written.
    expect(skill.content).toMatch(/1\. Check that this is a style request \(otherwise: `skill-author`/);
    // The listing blurb says so too, so the model picks the right skill before opening this one.
    expect(skill.description).toContain('Writing styles only');
    expect(skill.description).toContain('skill-author');
  });

  it('writes through update_skill_file into the project skills root — no .claude/skills, no file built-ins', () => {
    expect(skill.content).toContain('update_skill_file');
    expect(skill.content).toContain('.claude4spec/skills/<slug>/');
    expect(skill.content).not.toContain('.claude/skills');
    expect(skill.description).toContain('update_skill_file');
    expect(skill.description).not.toContain('.claude/skills');
  });
});

/**
 * 2.1.77 (M15 `m15wsauth`, `e5635uwn`, `lyygimdd`, `m15edg001`; pkg `vt1nmnwx`,
 * `l71kgcft`) — one route: the style is always a local style, a package of this
 * project's skills root written with `update_skill_file`. The skill never writes a
 * page of the project, works the same in a project of any type, and only MENTIONS
 * that a style for the other projects of the workspace is a separate Writing Style
 * project the author creates and attaches by hand. What the agent does is what the
 * skill text instructs, so that text is the observable asserted here.
 */
describe('c4s-plugin-writing-style-author — a local style only (2.1.77)', () => {
  const c = skill.content;
  /** One top-level bold paragraph of the skill, by its lead-in. */
  const para = (lead: string) => {
    const at = c.indexOf(`**${lead}**`);
    expect(at, `paragraph ${lead} exists`).toBeGreaterThan(-1);
    const end = c.indexOf('\n\n', at);
    return c.slice(at, end > -1 ? end : undefined);
  };

  it('the exposed-style route is gone: no route choice, no base-root pages, no exposing the project', () => {
    expect(c).not.toMatch(/Route [AB]/);
    expect(c).not.toContain('which route');
    expect(c).not.toContain('skill.entry');
    expect(c).not.toContain('Expose this project as a skill');
    expect(c).not.toContain('set **Scope** to `writing-style`');
    expect(c).not.toContain('as pages of the base root');
    expect(c).not.toMatch(/load_skill_file\("<skill\.name>"/);
    expect(skill.description).not.toContain("this project's own pages");
    expect(skill.description).not.toContain('settled with the user (or asked) before the first write');
  });

  it('the generated SKILL.md is the one place the scaffold writes the form clause', () => {
    const at = c.indexOf('**Always include the form clause in the body you write.**');
    expect(at).toBeGreaterThan(-1);
    expect(c.slice(at, c.indexOf('```', at))).toContain('the generated style must enumerate the entity form');
    // The clause names the entity form before the fenced one.
    const start = c.indexOf('**Form clause.**');
    const clause = c.slice(start, c.indexOf('```', start));
    expect(clause.indexOf('an embed of project entities')).toBeGreaterThan(-1);
    expect(clause.indexOf('an embed of project entities')).toBeLessThan(clause.indexOf('a fenced block'));
  });

  it('never writes a project page — update_skill_file only, no page tool in any step (the turn-level check is in agent-turn.test.ts)', () => {
    const pages = para('Project pages are out of scope.');
    expect(pages).toContain('Never write a page of the project — no `create_page`, no `update_sections`, no other page tool');
    expect(pages).toContain('also in a project of type Writing Style');
    expect(pages).toContain("Everything this skill writes is a file of a package in the project's `skills` root, written with `update_skill_file`");
    // Every write step of the workflow is an update_skill_file call; none names a page tool to call.
    const workflow = c.slice(c.indexOf('## Workflow'));
    expect(workflow).toContain('update_skill_file({ slug, file: "SKILL.md", content, expectedHash: "" })');
    expect(workflow).not.toContain('create_page');
    expect(workflow).not.toContain('update_sections');
    expect(workflow).toContain('At no step do you write a page of the project: the scaffold leaves every page as it was.');
    expect(skill.description).toContain('it never writes project pages');
  });

  it('works the same in a project of any type and reads neither the type nor the capabilities', () => {
    expect(para('Project pages are out of scope.')).toContain(
      "This works the same in a project of any type: do not read the project's type or its capabilities to decide anything here.",
    );
  });

  it('asked for a style for the other projects of the workspace, it mentions a separate Writing Style project the author creates and attaches on #skills by hand — and does neither itself', () => {
    const other = para('A style for other projects of the workspace.');
    expect(other).toContain('What you write is always a local style');
    expect(other).toContain('create a separate project of type Writing Style and attach it');
    expect(other).toContain('they register that project and attach it themselves, in the **`#skills` tab of the project settings**');
    expect(other).toContain('You do not create that project, do not attach it and do not write its pages');
    expect(other).toContain('If they still want a style here, write the local style.');
    expect(c).toMatch(/2\. If the author wants the style for the other projects of the workspace/);
    expect(skill.description).toContain('a separate project of type Writing Style, which the author creates and attaches in the #skills settings tab by hand');
  });
});

/**
 * M15 `n0fj7m42` (2.1.77 wording) — a user does not wait for another envelope: they
 * make their own style through `writing-style-author` as a package in this
 * project's skills root, or set up a separate Writing Style project and attach it.
 * The skill's listing description is where that availability is told.
 */
describe('c4s-plugin-writing-style-author — availability (2.1.77)', () => {
  it("[section:n0fj7m42] the description of how a user makes their own style names this project's package and the separate Writing Style project to attach", () => {
    const d = skill.description;
    expect(d).toContain("a package in the project's skills root");
    expect(d).toContain('A style for the other projects of the workspace is a separate project of type Writing Style');
    expect(d).toContain('attaches in the #skills settings tab by hand');
    expect(d.indexOf("a package in the project's skills root")).toBeLessThan(d.indexOf('a separate project of type Writing Style'));
  });
});
