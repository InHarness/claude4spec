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
 * 2.1.15 (M15 `1fjp0yb7`, `cb70i2o5`, `lyygimdd`, `m15edg001`; pkg `vt1nmnwx`) — two
 * routes. Route A is the package in this project's skills root (above); Route B is
 * the project itself, exposed as a style for the other projects of the workspace,
 * written as its own base-root pages. What the agent does on each route is what the
 * skill text instructs, so that text is the observable asserted here.
 */
describe('c4s-plugin-writing-style-author — two routes (2.1.15)', () => {
  const c = skill.content;
  /** The Route B description section, up to the workflow. */
  const routeB = c.slice(c.indexOf('## Route B — this project exposed as a style'), c.indexOf('## Workflow'));
  /** The Route B workflow steps, to the end of the skill. */
  const stepsB = c.slice(c.indexOf('### Route B'));
  /** The single step whose label is given (`B2.`, …), to the next blank line. */
  const step = (label: string) => {
    const at = stepsB.indexOf(`${label} `);
    expect(at, `step ${label} exists`).toBeGreaterThan(-1);
    const end = stepsB.indexOf('\n\n', at);
    return stepsB.slice(at, end > -1 ? end : undefined);
  };

  it('has both routes, the second one after the first', () => {
    expect(routeB.length).toBeGreaterThan(200);
    expect(stepsB.length).toBeGreaterThan(200);
    expect(c.indexOf('## Route A — a style for this project')).toBeGreaterThan(-1);
    expect(c.indexOf('## Route A — a style for this project')).toBeLessThan(c.indexOf('## Route B'));
  });

  it('[ac:ac-gdy-prosba-o-nowy-styl-nie-wskazuje-c] when the request does not say whether the style is for this project or for the other projects of the workspace, the skill asks before the first write', () => {
    const first = c.slice(c.indexOf('## First: which route'), c.indexOf('## Route A'));
    expect(first).toContain('settle the route **before the first write**');
    expect(first).toMatch(
      /If the conversation does not settle which project the style is for — this one, or the other projects of the workspace — \*\*ask before you write anything\*\*; do not guess\./,
    );
    // The workflow puts that question ahead of every write step.
    const ask = c.indexOf('2. Settle the route');
    expect(ask).toBeGreaterThan(-1);
    expect(c.slice(ask, c.indexOf('\n', ask))).toContain('ask now — before the first write');
    expect(ask).toBeLessThan(c.indexOf('A2. Write `SKILL.md`'));
    expect(ask).toBeLessThan(c.indexOf('B2. Write the entry page'));
    // And the listing blurb says the route is settled (or asked) before writing.
    expect(skill.description).toContain('settled with the user (or asked) before the first write');
  });

  it('[ac:ac-na-drodze-stylu-wystawionego-tresc-st] on the exposed-style route the style is written as pages of the project base root', () => {
    expect(routeB).toContain("**the style is this project's pages**: the pages of the project's base root");
    expect(routeB).toContain("the page named by the project's `skill.entry`");
    expect(routeB).toContain('Subfiles** are the other pages of the base root, each addressed by its path in that root');
    expect(routeB).toContain('Write them with the page tools**: `create_page`');
    expect(routeB).toContain('`update_sections`');
    expect(routeB).toContain('Nothing is written to the `skills` root');
    expect(step('B2.')).toContain('`create_page`');
    expect(step('B3.')).toContain('as pages of the base root, one `create_page` each');
  });

  it('[ac:ac-na-drodze-stylu-wystawionego-writing] on the exposed-style route writing-style-author does not call update_skill_file', () => {
    expect(routeB).toContain('`update_skill_file` is never called');
    expect(routeB).toContain('Never `update_skill_file`.');
    expect(step('B3.')).toContain('Never `update_skill_file` on this route.');
    // No Route B step instructs an update_skill_file call (only B3 names it, to forbid it).
    for (const label of ['B1.', 'B2.', 'B4.']) {
      expect({ label, calls: step(label).includes('update_skill_file') }).toEqual({ label, calls: false });
    }
  });

  it('[ac:ac-na-drodze-stylu-wystawionego-writing-2] on the exposed-style route writing-style-author does not change the project configuration', () => {
    expect(routeB).toContain("Do not change the project's configuration on this route — no config endpoints, no toggling exposure yourself.");
    expect(step('B4.')).toMatch(/^B4\. Change no configuration\./);
  });

  it('[ac:ac-na-drodze-stylu-wystawionego-writing-3] on the exposed-style route writing-style-author ends by pointing at the #skills tab of the project settings', () => {
    expect(routeB).toContain('Finish by pointing the author to the **`#skills` tab of the project settings**');
    expect(routeB).toContain('set **Scope** to `writing-style`');
    // B4 is the last step of the route, and it is the pointer.
    const b4 = step('B4.');
    expect(b4).toContain('End by pointing the author to the `#skills` tab of the project settings');
    expect(stepsB.trimEnd().endsWith(b4.trimEnd())).toBe(true);
  });

  it('[ac:ac-strona-wejscia-stylu-wystawionego-nap] the entry page of an exposed style refers to subfiles by a load_skill_file address carrying the project skill.name', () => {
    expect(routeB).toContain(
      'The entry page sends the reader to a subfile with `load_skill_file("<skill.name>", "workflows/brief.md")`, where `<skill.name>` is this project\'s `skill.name`',
    );
    // Section refs / embeds are not pointers: they reach the consumer as text.
    expect(routeB).toContain('Do not use section references or entity embeds as pointers');
    expect(step('B2.')).toContain('a `load_skill_file("<skill.name>", "workflows/…")` address for each subfile');
  });

  it('[ac:ac-strona-wejscia-stylu-wystawionego-nap-2] the entry page of an exposed style carries the form clause — the entity form listed before the fenced one', () => {
    expect(routeB).toContain('**The entry page carries the form clause**');
    expect(step('B2.')).toContain('the form clause from step A3 verbatim');
    // The clause B2 refers to: entity form before the fence, in the verbatim block.
    const start = c.indexOf('**Form clause.**');
    const clause = c.slice(start, c.indexOf('```', start));
    const entity = clause.indexOf('an embed of project entities');
    const fence = clause.indexOf('a fenced block');
    expect(entity).toBeGreaterThan(-1);
    expect(fence).toBeGreaterThan(-1);
    expect(entity).toBeLessThan(fence);
  });

  it('warns on Route A in an exposed project that the package will not reach consumers', () => {
    expect(c).toContain('a style written on Route A will not reach any project that attaches this one');
  });
});

/**
 * 2.1.15 (M15 `n0fj7m42`) — a user does not wait for another envelope: they make
 * their own style through `writing-style-author`, as a package of this project or
 * as a project exposed to the other projects of the workspace. The skill's listing
 * description is where that availability is told, so it names both routes.
 */
describe('c4s-plugin-writing-style-author — availability names both routes (2.1.15)', () => {
  it("[section:n0fj7m42] the description of how a user makes their own style names both routes — this project's package, and a project exposed to the workspace", () => {
    const d = skill.description;
    expect(d).toContain("a style for this project is a package in the project's skills root");
    expect(d).toContain("a style for the other projects of the workspace is this project's own pages");
    expect(d).toContain('exposed by the author in the #skills settings tab');
    // The two routes are told as alternatives, not as one root.
    expect(d.indexOf('a style for this project')).toBeLessThan(d.indexOf('a style for the other projects of the workspace'));
  });
});
