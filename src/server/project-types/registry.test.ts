import { describe, expect, it } from 'vitest';
import { buildCapabilityRegistry, hostCapabilityRegistry, ProjectTypeRegistryError } from './capabilities.js';
import { buildProjectTypeRegistry, hostProjectTypeRegistry, type ProjectTypeEntry } from './registry.js';
import { HOST_PROJECT_TYPE_ENTRIES } from './entries.js';
import { FieldRegistry } from '../settings/field-registry.js';
import { buildFieldRegistry } from '../settings/registry.js';
import { DEFAULT_PROJECT_TYPE } from '../config.js';

/** The code-snippets' `code`, verbatim at 2.1.77. */
const SNIPPET = {
  'opis-typu-spec-do-promptu':
    'This project is a Specification: it describes a system in markdown pages and structured entities, so that people and agents can build and change that system from one source of truth. Pages carry the prose; entities carry the shapes that other pages reference. Changes to the specification are released, and briefs hand a released change over to implementation.',
  'opis-typu-skill-do-promptu':
    'This project is a Skill: its pages are, as a whole, one package of instructions for agents, exposed to the other projects of the workspace. The entry page is what an agent reads first when the skill is loaded; every other page is a subfile of the package that the entry page may point to. Write each page for the agent that will follow it, not for a human reader of a specification. The project has no entities and no briefs.',
  'opis-typu-writing-style-do-promptu':
    "This project is a Writing Style: its pages are, as a whole, one writing style that other projects of the workspace can select as binding on everything their agent writes. The entry page is what an agent reads first when the style is active; every other page is a subfile of the style — a workflow, a template, a checklist — that the entry page routes to. Write each page as a rule an agent will follow in someone else's specification. The project has no entities and no briefs.",
  'welcome-template-index':
    '---\ntitle: "Welcome"\norder: 0\n---\n\n# Welcome to your specification\n\nStart by creating pages in the sidebar, or use the chat to generate content with AI assistance.\n\n## Quick start\n\n1. Create pages in **Pages** sidebar\n2. Define entities (Endpoints, DTOs) in **Entities** sidebar\n3. Reference entities in pages using slash commands (`/mention`, `/element`)\n4. Use **Chat** to get AI help writing your specification\n',
};

const deps = () => ({ capabilities: hostCapabilityRegistry(), fields: buildFieldRegistry() });

const entry = (over: Partial<ProjectTypeEntry> = {}): ProjectTypeEntry => ({
  slug: 'x-type',
  name: 'X',
  description: 'd',
  promptDescription: 'p',
  capabilities: [],
  onboarding: null,
  starterContent: null,
  ...over,
});

function refusal(fn: () => unknown): ProjectTypeRegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectTypeRegistryError);
    expect((err as ProjectTypeRegistryError).code).toBe('PROJECT_TYPE_REGISTRY_INVALID');
    return err as ProjectTypeRegistryError;
  }
  throw new Error('expected a PROJECT_TYPE_REGISTRY_INVALID refusal, got none');
}

describe('M57 L20 — the host project-type registry (2.1.77)', () => {
  it('holds the entries of M58, M59, M60 in registration order with their identity and capability sets', () => {
    const reg = hostProjectTypeRegistry();
    expect(reg.list().map((e) => [e.slug, e.name, e.description, e.capabilities])).toEqual([
      [
        'spec',
        'Specification',
        'Describe a system in pages and structured entities, release changes and hand them over to implementation as briefs.',
        ['entities', 'briefs', 'multi-root'],
      ],
      [
        'skill',
        'Skill',
        'Write one package of instructions for agents and expose it to the other projects of this workspace.',
        ['skill-exposure'],
      ],
      [
        'writing-style',
        'Writing Style',
        'Write a writing style that other projects of this workspace can select for their agent.',
        ['skill-exposure'],
      ],
    ]);
    // The config default names a registered type.
    expect(reg.has(DEFAULT_PROJECT_TYPE)).toBe(true);
    expect(reg.get('spec')!.onboarding).toBeNull();
  });

  it('[snippet:opis-typu-spec-do-promptu] the Specification entry carries the snippet verbatim as its prompt description', () => {
    expect(hostProjectTypeRegistry().get('spec')!.promptDescription).toBe(SNIPPET['opis-typu-spec-do-promptu']);
  });

  it('[snippet:opis-typu-skill-do-promptu] the Skill entry carries the snippet verbatim as its prompt description', () => {
    expect(hostProjectTypeRegistry().get('skill')!.promptDescription).toBe(SNIPPET['opis-typu-skill-do-promptu']);
  });

  it('[snippet:opis-typu-writing-style-do-promptu] the Writing Style entry carries the snippet verbatim as its prompt description', () => {
    expect(hostProjectTypeRegistry().get('writing-style')!.promptDescription).toBe(
      SNIPPET['opis-typu-writing-style-do-promptu'],
    );
  });

  it('[snippet:welcome-template-index] the Specification starter content is the welcome template verbatim, at pages/index.md, with no placeholders and no entry keys', () => {
    const starter = hostProjectTypeRegistry().get('spec')!.starterContent!;
    expect(starter.template).toBe(SNIPPET['welcome-template-index']);
    expect(starter.path).toBe('index.md');
    expect(starter.entryKeys).toEqual([]);
    expect(starter.template).not.toMatch(/\{[A-Za-z][\w.-]*\}/);
  });

  it('cards() carries only slug, name and user description', () => {
    for (const card of hostProjectTypeRegistry().cards()) {
      expect(Object.keys(card).sort()).toEqual(['description', 'name', 'slug']);
    }
  });
});

describe('M57 L20 — entry validation (2.1.77, `91ci7cqx`)', () => {
  it('accepts the host entries', () => {
    expect(() => buildProjectTypeRegistry(HOST_PROJECT_TYPE_ENTRIES, deps())).not.toThrow();
  });

  it('refuses a non-kebab slug', () => {
    expect(refusal(() => buildProjectTypeRegistry([entry({ slug: 'Not_Kebab' })], deps())).declaration).toBe(
      'Not_Kebab',
    );
  });

  it('refuses a duplicate slug, naming it', () => {
    const err = refusal(() => buildProjectTypeRegistry([entry(), entry({ name: 'Y' })], deps()));
    expect(err.declaration).toBe('x-type');
  });

  it('refuses an undeclared capability and a set not closed under dependencies', () => {
    refusal(() => buildProjectTypeRegistry([entry({ capabilities: ['nope'] })], deps()));
    const caps = buildCapabilityRegistry([
      { name: 'a', owner: 'M1', dependsOn: [] },
      { name: 'b', owner: 'M2', dependsOn: ['a'] },
    ]);
    refusal(() =>
      buildProjectTypeRegistry([entry({ capabilities: ['b'] })], { capabilities: caps, fields: new FieldRegistry() }),
    );
  });

  it('refuses an undeclared type key and a type key whose requirement does not fit the set', () => {
    refusal(() =>
      buildProjectTypeRegistry([entry({ onboarding: { typeKeys: ['no.such'], steps: [] } })], deps()),
    );
    const fields = new FieldRegistry().register({
      key: 'k',
      owner: 't',
      type: 'string',
      default: '',
      effect: 'none',
      resumeLock: false,
      apiWritable: true,
      requires: ['entities'],
    });
    const caps = hostCapabilityRegistry();
    refusal(() =>
      buildProjectTypeRegistry([entry({ onboarding: { typeKeys: ['k'], steps: [] } })], { capabilities: caps, fields }),
    );
    expect(() =>
      buildProjectTypeRegistry([entry({ capabilities: ['entities'], onboarding: { typeKeys: ['k'], steps: [] } })], {
        capabilities: caps,
        fields,
      }),
    ).not.toThrow();
  });

  it('refuses a step writing a non-type key and a replacing step missing a key of the replaced common step', () => {
    const decl = (key: string) => ({
      key,
      owner: 't',
      type: 'string' as const,
      default: '',
      effect: 'none' as const,
      resumeLock: false,
      apiWritable: true,
    });
    const fields = new FieldRegistry().register(decl('a'), decl('b'), decl('name'));
    const common = [{ name: 'Project', writes: ['name'] }];
    const d = { capabilities: hostCapabilityRegistry(), fields, commonSteps: common };
    const step = { title: 'S', position: { relation: 'after' as const, commonStep: 'Project' }, replaces: null };
    refusal(() =>
      buildProjectTypeRegistry([entry({ onboarding: { typeKeys: ['a'], steps: [{ ...step, writes: ['b'] }] } })], d),
    );
    refusal(() =>
      buildProjectTypeRegistry(
        [entry({ onboarding: { typeKeys: ['a'], steps: [{ ...step, writes: ['a'], replaces: 'Project' }] } })],
        d,
      ),
    );
    expect(() =>
      buildProjectTypeRegistry(
        [
          entry({
            onboarding: { typeKeys: ['a', 'name'], steps: [{ ...step, writes: ['a', 'name'], replaces: 'Project' }] },
          }),
        ],
        d,
      ),
    ).not.toThrow();
  });

  it('refuses a starter-content placeholder naming neither a common nor a type key', () => {
    const starter = (template: string) => ({ path: 'index.md', template, entryKeys: [] });
    refusal(() => buildProjectTypeRegistry([entry({ starterContent: starter('# {skill.name}') })], deps()));
    const fields = new FieldRegistry().register({
      key: 'skill.name',
      owner: 't',
      type: 'string',
      default: '',
      effect: 'none',
      resumeLock: false,
      apiWritable: true,
    });
    expect(() =>
      buildProjectTypeRegistry(
        [entry({ onboarding: { typeKeys: ['skill.name'], steps: [] }, starterContent: starter('# {skill.name}') })],
        { capabilities: hostCapabilityRegistry(), fields },
      ),
    ).not.toThrow();
  });
});
