import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput } from '../../chat-context.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import { HOST_PROJECT_TYPE_ENTRIES } from '../../../project-types/entries.js';
import { workspacePeers } from '../../../workspace/peer-config.js';

/**
 * 2.1.77 (u06) — the project type in the agent's prompt:
 *   - M57 `7ngvgv5z`: `<project_type>` (template `szablon-project-type`), its body
 *     the type entry's prompt description (`opis-typu-*-do-promptu`), verbatim;
 *   - M48 `7yqp77g8`: `type="…"` on `<project>`, in both variants (the brief
 *     composition's too);
 *   - M48 `j9sxaiqy`: `<entities>` and the body of `<claude4spec_identity>` read
 *     the capability `entities`;
 *   - M31 `qtqqqwfp` / `gofah0an`: `type="…"` on every `<peer>`, from the copy
 *     of the type in the peer's registry record; no `skill` attribute.
 *
 * A turn's input is what the project context hands the turn: the type slug and
 * the capability `entities` of the type's entry (`project-context.ts` →
 * `agent-turn.ts`).
 */

/** `szablon-project-type`, verbatim. */
const SZABLON_PROJECT_TYPE =
  '<project_type>\n{opis do promptu z wpisu typu projektu — wstawiany dosłownie, bez wstawek z danych projektu}\n</project_type>';
const PLACEHOLDER = '{opis do promptu z wpisu typu projektu — wstawiany dosłownie, bez wstawek z danych projektu}';

/** The `code` of `opis-typu-spec-do-promptu`, verbatim. */
const OPIS_SPEC =
  'This project is a Specification: it describes a system in markdown pages and structured entities, so that people and agents can build and change that system from one source of truth. Pages carry the prose; entities carry the shapes that other pages reference. Changes to the specification are released, and briefs hand a released change over to implementation.';
/** The `code` of `opis-typu-skill-do-promptu`, verbatim. */
const OPIS_SKILL =
  'This project is a Skill: its pages are, as a whole, one package of instructions for agents, exposed to the other projects of the workspace. The entry page is what an agent reads first when the skill is loaded; every other page is a subfile of the package that the entry page may point to. Write each page for the agent that will follow it, not for a human reader of a specification. The project has no entities and no briefs.';
/** The `code` of `opis-typu-writing-style-do-promptu`, verbatim. */
const OPIS_WRITING_STYLE =
  "This project is a Writing Style: its pages are, as a whole, one writing style that other projects of the workspace can select as binding on everything their agent writes. The entry page is what an agent reads first when the style is active; every other page is a subfile of the style — a workflow, a template, a checklist — that the entry page routes to. Write each page as a rule an agent will follow in someone else's specification. The project has no entities and no briefs.";

const emptyHost = { listEntities: () => [] } as unknown as ProjectPluginHost;
const endpointHost = {
  listEntities: () => [{ type: 'endpoint', systemPrompt: { roleNoun: 'Endpoints' } }],
} as unknown as ProjectPluginHost;

/** The turn's input for a project of `type`, its `entities` taken from the type's entry. */
function promptFor(type: string, overrides: Partial<SystemPromptInput> = {}): string {
  const entry = HOST_PROJECT_TYPE_ENTRIES.find((e) => e.slug === type);
  if (!entry) throw new Error(`no host type ${type}`);
  return buildSystemPrompt({
    host: emptyHost,
    projectName: 'Alpha',
    cwd: '/tmp/alpha',
    roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
    currentPagePath: null,
    currentPageBody: null,
    contextType: 'chat',
    projectType: type,
    ...(entry.capabilities.includes('entities') ? {} : { entities: false }),
    ...overrides,
  });
}

function block(out: string, tag: string): string {
  const whole = new RegExp(`^<${tag}(?=[ >])[\\s\\S]*?^</${tag}>$`, 'm').exec(out);
  if (whole) return whole[0];
  return new RegExp(`^<${tag}(?: [^\\n]*)?/>$`, 'm').exec(out)?.[0] ?? '';
}

describe('M57 — <project_type> (L16 `7ngvgv5z`)', () => {
  it('[entity:szablon-project-type] renders the template verbatim, its placeholder filled with the type entry\'s prompt description', () => {
    expect(block(promptFor('spec'), 'project_type')).toBe(SZABLON_PROJECT_TYPE.replace(PLACEHOLDER, OPIS_SPEC));
  });

  it('[entity:opis-typu-spec-do-promptu] the Specification entry\'s prompt description is the snippet\'s code, verbatim', () => {
    expect(HOST_PROJECT_TYPE_ENTRIES.find((e) => e.slug === 'spec')?.promptDescription).toBe(OPIS_SPEC);
  });

  it('[entity:opis-typu-skill-do-promptu] the Skill entry\'s prompt description is the snippet\'s code, verbatim', () => {
    expect(HOST_PROJECT_TYPE_ENTRIES.find((e) => e.slug === 'skill')?.promptDescription).toBe(OPIS_SKILL);
  });

  it('[entity:opis-typu-writing-style-do-promptu] the Writing Style entry\'s prompt description is the snippet\'s code, verbatim', () => {
    expect(HOST_PROJECT_TYPE_ENTRIES.find((e) => e.slug === 'writing-style')?.promptDescription).toBe(OPIS_WRITING_STYLE);
  });

  it('[ac:ac-blok-project-type-w-projekcie-typu-sk] in a Skill project <project_type> holds the Skill description verbatim', () => {
    expect(block(promptFor('skill'), 'project_type')).toBe(`<project_type>\n${OPIS_SKILL}\n</project_type>`);
  });

  it('[ac:ac-blok-project-type-w-projekcie-typu-sp] in a Specification project <project_type> holds the Specification description verbatim', () => {
    expect(block(promptFor('spec'), 'project_type')).toBe(`<project_type>\n${OPIS_SPEC}\n</project_type>`);
  });

  it('[ac:ac-blok-project-type-w-projekcie-typu-wr] in a Writing Style project <project_type> holds the Writing Style description verbatim', () => {
    expect(block(promptFor('writing-style'), 'project_type')).toBe(`<project_type>\n${OPIS_WRITING_STYLE}\n</project_type>`);
  });

  it('[ac:ac-dwa-projekty-tego-samego-typu-dostaja] two projects of the same type get <project_type> with identical content — whatever their name, directory, roots or language', () => {
    for (const type of ['spec', 'skill', 'writing-style']) {
      const a = block(promptFor(type), 'project_type');
      const b = block(
        promptFor(type, {
          projectName: 'Beta',
          cwd: '/srv/beta',
          roots: [{ id: 'docs', name: 'docs', dir: 'docs', builtin: true }],
          specLanguage: 'Polski',
          conversationalLanguage: 'Deutsch',
          host: endpointHost,
        }),
        'project_type',
      );
      expect(a).not.toBe('');
      expect(b).toBe(a);
      // No insertion from the project's data, and the slug is not repeated.
      expect(b).not.toContain('Beta');
      expect(b).not.toContain('/srv/beta');
      expect(b).not.toContain(`"${type}"`);
    }
  });

  it('[ac:ac-kazdy-projekt-niezaleznie-od-typu-dos] every project, whatever its type, gets a <project_type> block in the agent prompt — in every context type of the default composition', () => {
    for (const entry of HOST_PROJECT_TYPE_ENTRIES) {
      for (const contextType of ['chat', 'patch', 'ask'] as const) {
        const out = promptFor(entry.slug, { contextType });
        expect(out.split('<project_type>')).toHaveLength(2);
        expect(block(out, 'project_type')).toBe(`<project_type>\n${entry.promptDescription}\n</project_type>`);
      }
    }
    // A rig with no type is a Specification and still gets the block.
    const untyped = buildSystemPrompt({
      host: emptyHost,
      projectName: 'Alpha',
      cwd: '/tmp/alpha',
      roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
      currentPagePath: null,
      currentPageBody: null,
    });
    expect(block(untyped, 'project_type')).toBe(`<project_type>\n${OPIS_SPEC}\n</project_type>`);
  });
});

describe('M48 — the type on <project> (`7yqp77g8`)', () => {
  it('[ac:m48-project-carries-type-attribute] <project> in the default composition carries `type` with the current project\'s type slug', () => {
    for (const type of ['spec', 'skill', 'writing-style']) {
      const tag = block(promptFor(type), 'project');
      expect(tag).toBe(`<project name="Alpha" cwd="/tmp/alpha" type="${type}" roots="pages=pages"/>`);
    }
  });

  it('[ac:m48-brief-project-carries-type-attribute] <project> in the brief composition carries `type` with the current project\'s type slug', () => {
    for (const type of ['spec', 'skill', 'writing-style']) {
      const out = promptFor(type, { contextType: 'brief', brief: null });
      expect(out).toContain('<interaction_context type="brief"');
      expect(block(out, 'project')).toBe(`<project name="Alpha" cwd="/tmp/alpha" type="${type}"/>`);
    }
  });
});

describe('M48 — what reads the capability `entities` (`j9sxaiqy`)', () => {
  it('[ac:m48-no-entities-block-without-capability] in a `skill` project the `chat` prompt has no <entities> block', () => {
    const out = promptFor('skill', { contextType: 'chat', host: endpointHost });
    expect(out).not.toContain('<entities>');
    expect(out).not.toMatch(/^<entities\b/m);
    // Control: a `spec` project on the same host has it.
    expect(promptFor('spec', { contextType: 'chat', host: endpointHost })).toContain('<entities>');
  });

  it('[ac:m48-entities-block-empty-whitelist] in a `spec` project with an empty `config.entities` the `chat` prompt has <entities> with an empty list of types', () => {
    // `config.entities = []` ⇒ no active type ⇒ the host lists no entity.
    const b = block(promptFor('spec', { contextType: 'chat', host: emptyHost }), 'entities');
    expect(b.startsWith('<entities>\n')).toBe(true);
    expect(b.endsWith('\n</entities>')).toBe(true);
    expect(b).not.toMatch(/<entity\s/);
    expect(b).toContain('Call describe_entity_type(type)');
    expect(b).toContain('Record counts are not in this prompt');
  });

  it('[ac:m48-identity-without-entities] in a `skill` project <claude4spec_identity> does not contain the word “entities”', () => {
    const identity = block(promptFor('skill'), 'claude4spec_identity');
    expect(identity).toContain('You are a specification writing assistant for project "Alpha".');
    expect(identity).toContain('markdown pages on disk');
    expect(identity).not.toMatch(/entities/i);
    // Control: a `spec` project's identity speaks of entities.
    expect(block(promptFor('spec'), 'claude4spec_identity')).toContain('entities');
  });
});

describe('M31 — the peers come with the type of their record (`gofah0an`)', () => {
  it('[section:gofah0an] the peer list takes `type` from the copy in each peer\'s registry record (absent copy = spec, unknown slug verbatim), skips the current project and reads no type from config', () => {
    const peers = workspacePeers(
      [
        { id: 'alpha', cwd: '/w/alpha', projectType: 'spec' },
        { id: 'notes', cwd: '/w/notes', projectType: 'skill' },
        { id: 'style', cwd: '/w/style', projectType: 'writing-style' },
        { id: 'legacy', cwd: '/w/legacy' },
        { id: 'future', cwd: '/w/future', projectType: 'notebook' },
      ],
      'alpha',
      (cwd) => (cwd === '/w/notes' ? { name: 'Notes', description: 'How we take notes.' } : {}),
    );
    expect(peers).toEqual([
      { id: 'notes', name: 'Notes', description: 'How we take notes.', type: 'skill' },
      { id: 'style', type: 'writing-style' },
      { id: 'legacy', type: 'spec' },
      { id: 'future', type: 'notebook' },
    ]);
  });
});
