import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPluginTestApp, type PluginTestApp } from '../../../tests/helpers/plugin-test-setup.js';
import {
  buildExternalSkillContext,
  buildExternalSkillsBundle,
  capabilitiesOfProjectType,
  renderRefactorSkill,
  renderSpecReaderSkill,
  skillSlugsFor,
} from './external-skills-service.js';

/**
 * 2.1.77 (M22 `8tvwx2ry`, Odczyt możliwości; `m22dserv` — the render context
 * carries the project's capability set). A `skill` project has neither `briefs`
 * nor `entities`: its skill set is `c4s-spec-reader` + `c4s-refactor`, the
 * refactor text has no Path 2 (`c4s create-brief`), and neither text teaches an
 * entity read command. Each assertion runs against a `spec` control.
 */

/** Every `c4s` command that reads entities — the five tag aliases included. */
const ENTITY_READ_COMMANDS = [
  'describe',
  'list-tags',
  'list-entities',
  'get-entities',
  'get-field-content',
  'search-entities',
  'resolve-identity',
  'find-references',
  'inline_mention',
  'single_element',
  'element_list',
  'tagged_list',
  'tagged_list_mixed',
  'detail',
] as const;

/** The commands of `ENTITY_READ_COMMANDS` a text names — as `c4s <cmd>` or as a backticked `<cmd>`. */
function entityReadCommandsIn(text: string): string[] {
  return ENTITY_READ_COMMANDS.filter((cmd) => new RegExp(`(c4s ${cmd}|\`${cmd}\`)(?![\\w-])`).test(text));
}

const skillCaps = capabilitiesOfProjectType('skill')!;
const specCaps = capabilitiesOfProjectType('spec')!;
const ctxOf = (caps: ReadonlySet<string>) =>
  buildExternalSkillContext({ id: 'proj-x' }, { name: 'ws', defaultPort: 4500 }, 'https://c4s.example.test', caps);

describe('M22 skills rendered for a `skill` project (2.1.77)', () => {
  it('the `skill` type has neither `briefs` nor `entities`; `spec` has both', () => {
    expect([skillCaps.has('briefs'), skillCaps.has('entities')]).toEqual([false, false]);
    expect([specCaps.has('briefs'), specCaps.has('entities')]).toEqual([true, true]);
    expect(skillSlugsFor(skillCaps)).toEqual(['spec-reader', 'refactor']);
    expect([...buildExternalSkillsBundle(ctxOf(skillCaps)).keys()]).toEqual([
      'c4s-spec-reader/SKILL.md',
      'c4s-refactor/SKILL.md',
    ]);
    // A selection naming the excluded skill renders nothing for it.
    expect([...buildExternalSkillsBundle(ctxOf(skillCaps), ['brief-implementer']).keys()]).toEqual([]);
  });

  it('[ac:ac-w-projekcie-typu-skill-wyrenderowany] in a `skill` project the rendered `c4s-refactor/SKILL.md` does not contain the command `c4s create-brief`', () => {
    const skillText = buildExternalSkillsBundle(ctxOf(skillCaps)).get('c4s-refactor/SKILL.md')!;
    expect(skillText).toBe(renderRefactorSkill(ctxOf(skillCaps)));
    expect(skillText).not.toContain('create-brief');
    expect(skillText).not.toContain('briefPath');
    expect(skillText).not.toContain('Path 2');
    // code-fix goes to Report + STOP as a description for a human; Path 1 stays.
    expect(skillText).toContain('### 5. Path 1');
    expect(skillText).toMatch(/\*\*code-fix\*\*[^\n]*\n\s+\*\*Report \+ STOP\*\*/);
    expect(skillText).toContain('### 6. Report + STOP');
    // Control: a `spec` project's refactor skill carries Path 2.
    expect(renderRefactorSkill(ctxOf(specCaps))).toContain('c4s create-brief --body-file');
  });

  it('[ac:ac-w-projekcie-typu-skill-wyrenderowany-2] in a `skill` project the rendered `c4s-spec-reader/SKILL.md` contains no entity read command', () => {
    const skillText = buildExternalSkillsBundle(ctxOf(skillCaps)).get('c4s-spec-reader/SKILL.md')!;
    expect(skillText).toBe(renderSpecReaderSkill(ctxOf(skillCaps)));
    expect(entityReadCommandsIn(skillText)).toEqual([]);
    expect(skillText).not.toContain('## Resolving a tag');
    // Discovery stays with `catalog`, page and section navigation and `check-consistency`.
    for (const cmd of ['c4s catalog', 'c4s search-pages', 'c4s get-sections', 'c4s get-page-outline', 'c4s check-consistency']) {
      expect(skillText, cmd).toContain(cmd);
    }
    // Control: a `spec` project's reader teaches every one of them.
    expect(entityReadCommandsIn(renderSpecReaderSkill(ctxOf(specCaps)))).toEqual([...ENTITY_READ_COMMANDS]);
  });

  it('[ac:ac-w-projekcie-typu-skill-wyrenderowany-3] in a `skill` project the rendered `c4s-refactor/SKILL.md` contains no entity read command', () => {
    const skillText = buildExternalSkillsBundle(ctxOf(skillCaps)).get('c4s-refactor/SKILL.md')!;
    expect(entityReadCommandsIn(skillText)).toEqual([]);
    // Reading goes through `catalog`, page and section navigation and `resolve`.
    for (const cmd of ['c4s catalog', 'c4s search-pages', 'c4s get-sections', 'c4s resolve']) {
      expect(skillText, cmd).toContain(cmd);
    }
    // Control: a `spec` project's refactor skill reads entities.
    expect(entityReadCommandsIn(renderRefactorSkill(ctxOf(specCaps)))).toEqual(
      expect.arrayContaining(['list-tags', 'list-entities', 'single_element']),
    );
  });
});

describe('GET /api/external-skills in a `skill` project (2.1.77)', () => {
  let skill: PluginTestApp;
  let spec: PluginTestApp;

  beforeAll(async () => {
    skill = await createPluginTestApp([], { projectType: 'skill' });
    spec = await createPluginTestApp([]);
  }, 120_000);

  afterAll(async () => {
    await skill?.cleanup();
    await spec?.cleanup();
  });

  it('[ac:ac-w-projekcie-typu-skill-odpowiedz-get] in a `skill` project the response of `GET /api/external-skills` does not contain the skill `c4s-brief-implementer`', async () => {
    const res = await request(skill.app).get(`${skill.baseUrl}/external-skills`);
    expect(res.status).toBe(200);
    const skills = res.body.skills as Array<{ slug: string; name: string; description: string }>;
    expect(skills.map((s) => s.name)).not.toContain('c4s-brief-implementer');
    expect(skills.map((s) => s.slug)).not.toContain('brief-implementer');
    expect(skills.map((s) => s.name)).toEqual(['c4s-spec-reader', 'c4s-refactor']);
    // `?skills=` naming it is an unknown slug → 400.
    const bundle = await request(skill.app).get(`${skill.baseUrl}/external-skills/bundle?skills=brief-implementer`);
    expect(bundle.status).toBe(400);
    // Control: a `spec` project lists all three.
    const control = await request(spec.app).get(`${spec.baseUrl}/external-skills`);
    expect((control.body.skills as Array<{ name: string }>).map((s) => s.name)).toEqual([
      'c4s-spec-reader',
      'c4s-brief-implementer',
      'c4s-refactor',
    ]);
  });
});
