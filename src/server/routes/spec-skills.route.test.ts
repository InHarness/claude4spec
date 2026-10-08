import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig, writeConfig, type SkillConfig } from '../config.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { listExposedProjectRows, listExposedProjects } from '../services/exposed-projects.js';
import { specSkillsRouter } from './spec-skills.js';

/**
 * 2.1.9 — M52 L4: `GET /api/spec-skills/exposed-projects` (endpoint
 * `get-api-spec-skills-exposed-projects`, DTO `exposed-project-row`), the `rest`
 * rendering of `list_exposed_projects` (sheet `katalog-operacji-m52`, row 4).
 *
 * The rig is a workspace of real project directories with real `config.json`
 * files; the route is bound to the current project exactly as the project
 * context binds it (its id, its `skill.uses` read per call, the workspace's
 * exposed projects read per call).
 */

registerCoreOperations();

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function project(name: string, skill: SkillConfig): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-spec-skills-route-'));
  tmpDirs.push(cwd);
  writeConfig(cwd, { name, skill });
  return cwd;
}

/** A workspace: `shop` (current) attaches `billing-rules`, `ghost` (dangling) and `docs` (ambiguous). */
function workspace() {
  const projects = [
    { id: 'shop', cwd: project('Shop', { exposed: true, name: 'shop-skill', description: 'The shop.', uses: ['billing-rules', 'ghost', 'docs', 'shop-skill'] }) },
    { id: 'billing', cwd: project('Billing', { exposed: true, name: 'billing-rules', description: 'How billing works.' }) },
    { id: 'docs-a', cwd: project('Docs A', { exposed: true, name: 'docs', description: 'Docs A.' }) },
    { id: 'docs-b', cwd: project('Docs B', { exposed: true, name: 'docs', description: 'Docs B.' }) },
    { id: 'legal', cwd: project('Legal', { exposed: true, name: 'legal-terms', description: 'Terms.' }) },
    { id: 'hidden', cwd: project('Hidden', { exposed: false, name: 'hidden-skill', description: 'Not exposed.' }) },
  ];
  const shop = projects[0]!.cwd;
  const app = express().use(
    '/api/spec-skills',
    specSkillsRouter({
      listExposedProjects: () =>
        listExposedProjectRows('shop', readConfig(shop).skill?.uses ?? [], listExposedProjects(projects)),
    }),
  );
  return { app, shop, projects };
}

describe('GET /api/spec-skills/exposed-projects (M52 L4, 2.1.9)', () => {
  it('[entity:get-api-spec-skills-exposed-projects] GET answers 200 { data: rows } — every exposed project of the workspace and every attachment of the current project, dangling included; read-only', async () => {
    const { app, shop } = workspace();
    const before = fs.readFileSync(path.join(shop, '.claude4spec', 'config.json'), 'utf8');
    const res = await request(app).get('/api/spec-skills/exposed-projects');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect((res.body.data as Array<{ name: string }>).map((r) => r.name)).toEqual(['billing-rules', 'docs', 'ghost', 'legal-terms']);
    // Read-only: the current project's config is untouched.
    expect(fs.readFileSync(path.join(shop, '.claude4spec', 'config.json'), 'utf8')).toBe(before);
    // No other verb on the route.
    expect((await request(app).post('/api/spec-skills/exposed-projects').send({})).status).toBe(404);
  });

  it('[entity:exposed-project-row] each row carries name, description?, projectId?, uses and status (ok | unavailable | ambiguous)', async () => {
    const { app } = workspace();
    const res = await request(app).get('/api/spec-skills/exposed-projects');
    expect(res.body.data).toEqual([
      { name: 'billing-rules', description: 'How billing works.', projectId: 'billing', uses: true, status: 'ok' },
      // Ambiguous: two projects expose `docs` — no projectId, no description.
      { name: 'docs', uses: true, status: 'ambiguous' },
      // Dangling: nobody exposes `ghost` — the name written in skill.uses, no description, no projectId.
      { name: 'ghost', uses: true, status: 'unavailable' },
      { name: 'legal-terms', description: 'Terms.', projectId: 'legal', uses: false, status: 'ok' },
    ]);
    for (const row of res.body.data as Array<Record<string, unknown>>) {
      expect(Object.keys(row).every((k) => ['name', 'description', 'projectId', 'uses', 'status'].includes(k))).toBe(true);
      expect(typeof row.name).toBe('string');
      expect(typeof row.uses).toBe('boolean');
      expect(['ok', 'unavailable', 'ambiguous']).toContain(row.status);
    }
    // The current project never has a row — not even by its own name sitting in its `uses`.
    expect(JSON.stringify(res.body.data)).not.toContain('shop');
  });

  it('[ac:m52-dangling-attachment-marked-unavailable] a dangling attachment comes back with status `unavailable` — the #skills card marks it Unavailable', async () => {
    const { app, projects } = workspace();
    const ghost = (await request(app).get('/api/spec-skills/exposed-projects')).body.data.find((r: { name: string }) => r.name === 'ghost');
    expect(ghost).toEqual({ name: 'ghost', uses: true, status: 'unavailable' });
    // The provider of `billing-rules` stops exposing itself: that attachment is dangling now, too.
    writeConfig(projects[1]!.cwd, { skill: { exposed: false } });
    const billing = (await request(app).get('/api/spec-skills/exposed-projects')).body.data.find(
      (r: { name: string }) => r.name === 'billing-rules',
    );
    expect(billing).toEqual({ name: 'billing-rules', uses: true, status: 'unavailable' });
  });

  it('[entity:katalog-operacji-m52#list_exposed_projects] the catalog row: workspace scope, read, no error codes, rendered on rest only — and its rest rendering answers', async () => {
    const op = CATALOG.require('list_exposed_projects');
    expect(op.scope).toBe('workspace');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('read');
    expect(op.errorCodes).toEqual([]);
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect(op.channels.rest.kind).toBe('direct');
    for (const ch of ['internal', 'cli', 'mcp'] as const) {
      const cell = op.channels[ch];
      expect(cell.kind, ch).toBe('na');
      expect(cell.kind === 'na' && cell.reason).toContain('#skills settings card');
    }
    // Observable: the read has no guard — it answers, and answers the same twice.
    const { app } = workspace();
    const a = await request(app).get('/api/spec-skills/exposed-projects');
    const b = await request(app).get('/api/spec-skills/exposed-projects');
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
  });
});
