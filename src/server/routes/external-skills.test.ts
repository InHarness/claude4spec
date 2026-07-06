import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { WorkspaceRegistry } from '../workspace/registry.js';
import { externalSkillsRouter } from './external-skills.js';
import type { WorkspaceRecord } from '../workspace/types.js';

describe('externalSkillsRouter', () => {
  let registryDir: string;
  let projectDir: string;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let projectId: string;

  beforeEach(() => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-extskills-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-extskills-project-'));

    registry = new WorkspaceRegistry(registryDir);
    // 0.1.104 regression: `workspace` is captured BEFORE `registerProject` below,
    // mirroring claude4spec.ts's real startup order (registry.selectOrCreate(...)
    // happens first, bootstrapProject/registerProject mutates a SEPARATE
    // deserialized copy). The router must not trust this stale `.projects`
    // snapshot — it must re-read via `registry.getProject(workspace, projectId)`.
    workspace = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(workspace, projectDir);
    projectId = project.id;
  });

  afterEach(() => {
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const app = () => express().use(externalSkillsRouter({ registry, workspace, projectId }));

  it('GET / returns exactly three metadata entries, no SKILL.md content', async () => {
    const res = await request(app()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(3);
    for (const s of res.body.skills) {
      expect(s).toHaveProperty('slug');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('description');
      expect(s).not.toHaveProperty('content');
    }
  });

  it('GET /bundle returns a non-empty application/zip payload even though `workspace` predates registration', async () => {
    const res = await fetchZipBuffer(app(), '/bundle');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('external-skills.zip');
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // ZIP local-file-header magic bytes.
    expect((res.body as Buffer).subarray(0, 2).toString('hex')).toBe('504b');
  });

  it('GET /bundle?skills=bogus rejects an unknown slug with 400', async () => {
    const res = await request(app()).get('/bundle?skills=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('GET /bundle?skills=spec-reader narrows the selection without erroring', async () => {
    const res = await fetchZipBuffer(app(), '/bundle?skills=spec-reader');
    expect(res.status).toBe(200);
  });

  it('GET /bundle?skills=bogus&skills=spec-reader rejects an unknown slug even via a repeated query key', async () => {
    // Express's default query parser turns a repeated `?skills=` key into an
    // array, not a comma-joined string — parseSelection must validate every
    // value in that array too, not just the single-string CSV shape.
    const res = await request(app()).get('/bundle?skills=bogus&skills=spec-reader');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

function fetchZipBuffer(app: express.Express, url: string) {
  return request(app)
    .get(url)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}
