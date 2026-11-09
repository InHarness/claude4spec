import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPluginTestApp, type PluginTestApp } from '../../../tests/helpers/plugin-test-setup.js';
import { contextTypeRegistryFor } from '../services/chat-context.js';
import { SKILL_PROJECT_TYPE, SPEC_PROJECT_TYPE } from '../project-types/entries.js';

/**
 * 2.1.77 (M21 `dcagtfpe`/`msujcqhu`, M23 `iifnvhtu`, M36 `ff7ootuy`, M44
 * `1j39ajh8`) — the context of a `skill` project has neither briefs nor
 * patches: the type lacks the capability `briefs`, so M21 and M23 do not exist
 * in it. Proven on a real project context, against a `spec` control.
 */
describe('context of a `skill` project — no brief or patch modules (2.1.77)', () => {
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

  it('[ac:ac-w-projekcie-typu-skill-rejestr-typow] in a `skill` project the context-type registry holds only `chat` and `ask`', () => {
    // The project's registry, as the context built it.
    expect([...skill.contextTypes]).toEqual(['chat', 'ask']);
    // The same answer from the registry read for the type's capability set.
    const skillRegistry = contextTypeRegistryFor(new Set(SKILL_PROJECT_TYPE.capabilities));
    expect(Object.keys(skillRegistry)).toEqual(['chat', 'ask']);
    expect(skillRegistry.brief).toBeUndefined();
    expect(skillRegistry.patch).toBeUndefined();
    // Control: with `briefs` (a Specification) the registry has all four rows.
    expect([...spec.contextTypes]).toEqual(['chat', 'brief', 'patch', 'ask']);
    expect(Object.keys(contextTypeRegistryFor(new Set(SPEC_PROJECT_TYPE.capabilities)))).toEqual([
      'chat',
      'brief',
      'patch',
      'ask',
    ]);
  });

  it('[ac:ac-w-projekcie-typu-skill-zadanie-get-ap] in a `skill` project GET /api/artifacts/brief answers 404 UNKNOWN_ARTIFACT_KIND', async () => {
    const res = await request(skill.app).get(`${skill.baseUrl}/artifacts/brief`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNKNOWN_ARTIFACT_KIND');
    // `patch` is outside the set the same way; `plan` stays.
    const patch = await request(skill.app).get(`${skill.baseUrl}/artifacts/patch`);
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe('UNKNOWN_ARTIFACT_KIND');
    expect((await request(skill.app).get(`${skill.baseUrl}/artifacts/plan`)).status).toBe(200);
    // Control: a `spec` project lists briefs.
    expect((await request(spec.app).get(`${spec.baseUrl}/artifacts/brief`)).status).toBe(200);
  });

  it('[ac:ac-w-projekcie-typu-skill-zadanie-post-a] in a `skill` project POST /api/patches answers "not found"', async () => {
    const body = { brief: 'b.md', desc: 'drift', body: 'what drifted' };
    const res = await request(skill.app).post(`${skill.baseUrl}/patches`).send(body);
    expect(res.status).toBe(404);
    // Not the route's own BRIEF_NOT_FOUND guard — the route does not exist.
    expect(res.body?.error?.code).not.toBe('BRIEF_NOT_FOUND');
    // Control: in a `spec` project the route exists and runs its guard.
    const ctrl = await request(spec.app).post(`${spec.baseUrl}/patches`).send(body);
    expect(ctrl.status).toBe(404);
    expect(ctrl.body.error.code).toBe('BRIEF_NOT_FOUND');
  });

  it('M21 `dcagtfpe`: the `/api/briefs` route is not mounted without `briefs`', async () => {
    // The route has one handler, POST / (create); an empty body is its own 400 in `spec`.
    expect((await request(skill.app).post(`${skill.baseUrl}/briefs`).send({})).status).toBe(404);
    expect((await request(spec.app).post(`${spec.baseUrl}/briefs`).send({})).status).not.toBe(404);
  });
});
