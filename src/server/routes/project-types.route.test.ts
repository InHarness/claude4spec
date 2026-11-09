import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projectTypesRouter } from '../workspace/routes.js';
import { hostProjectTypeRegistry } from '../project-types/registry.js';

/**
 * 2.1.77 (M57 L4, endpoint `get-api-workspace-project-types`, DTO
 * `project-type-list-response`): the type list for the create-project page,
 * mounted outside the project prefix as `startServer` mounts it. The app here
 * has no project, no project context and no `/api/projects/:id` dispatch.
 */
const appWithoutProject = () => {
  const app = express();
  app.use('/api/workspace/project-types', projectTypesRouter({ types: hostProjectTypeRegistry() }));
  return app;
};

describe('GET /api/workspace/project-types (2.1.77)', () => {
  it('[ac:ac-get-api-workspace-project-types-zwrac] returns slug, name and user description of every registry type, with no project open', async () => {
    const res = await request(appWithoutProject()).get('/api/workspace/project-types');
    expect(res.status).toBe(200);
    const expected = hostProjectTypeRegistry()
      .list()
      .map((e) => ({ slug: e.slug, name: e.name, description: e.description }));
    expect(res.body).toEqual({ types: expected });
    expect(res.body.types.map((t: { slug: string }) => t.slug)).toEqual(['spec', 'skill', 'writing-style']);
  });

  it('[endpoint:get-api-workspace-project-types] answers 200 with exactly the ProjectTypeListResponse fields, in registry order', async () => {
    const res = await request(appWithoutProject()).get('/api/workspace/project-types');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // DTO `project-type-list-response`: `types` (required) and nothing else …
    expect(Object.keys(res.body)).toEqual(['types']);
    expect(Array.isArray(res.body.types)).toBe(true);
    expect(res.body.types.length).toBe(3);
    // … and each card carries exactly slug, name, description — all strings;
    // no prompt description, no capability set.
    for (const card of res.body.types as Array<Record<string, unknown>>) {
      expect(Object.keys(card).sort()).toEqual(['description', 'name', 'slug']);
      expect(typeof card.slug).toBe('string');
      expect(card.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(typeof card.name).toBe('string');
      expect(typeof card.description).toBe('string');
    }
    expect(res.body.types.map((t: { name: string }) => t.name)).toEqual(['Specification', 'Skill', 'Writing Style']);
  });

  it('takes no parameters: a query string changes nothing', async () => {
    const plain = await request(appWithoutProject()).get('/api/workspace/project-types');
    const withQuery = await request(appWithoutProject()).get('/api/workspace/project-types?project=x&type=skill');
    expect(withQuery.status).toBe(200);
    expect(withQuery.body).toEqual(plain.body);
  });
});
