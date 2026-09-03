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
    expect(manifest.contributes.settings).toBeUndefined();
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
    expect(skill.content).not.toContain('scope: contextual');
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
