import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPluginTestApp, type PluginTestApp } from '../../../tests/helpers/plugin-test-setup.js';

/**
 * 2.1.77 (M31 m31ctx001, M13 L19 `pmm7cm4c`) — the context of a `skill`
 * project builds only the modules whose required capabilities the project has.
 * `skill` lacks `entities`, so the context has no service of a module that
 * requires it: the active type set is empty (the built-in envelopes ARE in the
 * pool), the generic `entity-tools` server is not registered, and every route
 * under `/entities`, `/tags` and `/references` answers like a route that does
 * not exist. Proven on a real project context, against a `spec` control.
 */
describe('context of a `skill` project — no entity modules (2.1.77)', () => {
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

  const serverNames = (t: PluginTestApp) => {
    const names: string[] = [];
    t.host.buildMcpServers({ include: (name) => (names.push(name), false) });
    return names;
  };

  it('[ac:m31-context-builds-only-satisfied-modules] in a `skill` project a request to /api/projects/<id>/entities answers "not found", because the context has no services of the module requiring `entities`', async () => {
    // Control: the router is up (config answers) and a `spec` project serves the route.
    expect((await request(skill.app).get(`${skill.baseUrl}/config`)).status).toBe(200);
    expect((await request(spec.app).get(`${spec.baseUrl}/entities/counts`)).status).toBe(200);

    for (const route of ['/entities', '/entities/counts', '/entities/endpoint/tools']) {
      expect((await request(skill.app).get(`${skill.baseUrl}${route}`)).status, route).toBe(404);
    }
    // No type is active although the pool has them, and no entity server is registered.
    expect(skill.host.listAvailable().length).toBeGreaterThan(0);
    expect(skill.host.listEntities()).toEqual([]);
    expect(serverNames(skill)).not.toContain('entity-tools');
    expect(serverNames(skill).filter((n) => n.endsWith('-tools') && skill.host.listAvailable().some((m) => `${m.type}-tools` === n))).toEqual([]);
    expect(serverNames(spec)).toContain('entity-tools');
  });

  it('the modules requiring `entities` (tags M18, references M19) are not mounted either — 404', async () => {
    expect((await request(skill.app).get(`${skill.baseUrl}/tags`)).status).toBe(404);
    expect((await request(spec.app).get(`${spec.baseUrl}/tags`)).status).toBe(200);
    expect((await request(skill.app).get(`${skill.baseUrl}/references?type=endpoint&slug=x`)).status).toBe(404);
  });

  it('M19 `wjjr1oc0`, M18 `rxlzqki1`: `find_references` and the tag tools do not enter the agent servers — `reference-tools` keeps the page reads and `check_consistency`', () => {
    const toolsOf = (t: PluginTestApp) =>
      t.host
        .buildMcpServers({ include: (name) => name === 'reference-tools' })
        .flatMap(({ server }) => server.tools?.map((tool) => tool.name) ?? []);
    const skillTools = toolsOf(skill);
    for (const name of ['find_references', 'create_tag', 'list_tags', 'tag_entity']) {
      expect(skillTools, name).not.toContain(name);
    }
    expect(skillTools).toEqual(expect.arrayContaining(['check_consistency', 'get_sections', 'get_page']));
    // Control: a `spec` project renders the operation in its agent server.
    expect(toolsOf(spec)).toEqual(expect.arrayContaining(['find_references', 'list_tags', 'check_consistency']));
  });
});
