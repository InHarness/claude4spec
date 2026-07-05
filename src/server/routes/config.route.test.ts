import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath, type Config } from '../config.js';
import { configRouter } from './config.js';
import type { SkillRegistry } from '../services/skill-registry.js';

// 0.1.103: deterministic stand-in for probePathScope so agent.pathScopeStrength
// assertions don't depend on whether the CI/dev host actually has an OS sandbox
// (sandbox-exec/bwrap) available.
const hoisted = vi.hoisted(() => ({ strength: 'soft' as 'hard' | 'soft' | 'none' }));
vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    probePathScope: (...args: Parameters<typeof actual.probePathScope>) => ({
      ...actual.probePathScope(...args),
      strength: hoisted.strength,
    }),
  };
});

// 0.1.91 — the project `name` is display-only (folder identity is sha1(cwd), not the
// name), so the PATCH /config DTO accepts full Unicode and rejects only control chars.
describe('PATCH /config — name accepts full Unicode, rejects control chars (0.1.91)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-route-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'X' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    // A name-only PATCH never touches the writing-style registry, so an empty stub suffices.
    const router = configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry });
    return express().use(express.json()).use(router);
  };

  it('accepts a Unicode name (diacritics, CJK, emoji) and persists it', async () => {
    const name = 'Zażółć 项目 🚀';
    const res = await request(app()).patch('/config').send({ name });
    expect(res.status).toBe(200);
    expect((res.body as Config).name).toBe(name);
  });

  it('rejects a name containing a control character with a 400', async () => {
    const res = await request(app()).patch('/config').send({ name: 'bad\nname' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects an over-long (>80) name with a 400', async () => {
    const res = await request(app()).patch('/config').send({ name: 'a'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

// 0.1.103 — `agent.pathScopeStrength` mirrors agent-turn.ts's exact
// pathScopeRequested gate (empty ⇒ 'none'), then reflects the real probed
// runtime strength. probePathScope itself is mocked so the assertions don't
// depend on whether the test host actually has an OS sandbox (sandbox-exec/
// bwrap) available — that logic is agent-adapters' own, already covered there.
describe('GET/PATCH /config — agent.pathScopeStrength (0.1.103)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-route-strength-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'X' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    const router = configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry });
    return express().use(express.json()).use(router);
  };

  it("returns 'none' when no paths are configured, regardless of host sandbox support", async () => {
    const res = await request(app()).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.agent.pathScopeStrength).toBe('none');
  });

  it("returns 'hard' once a scope is configured when the mocked probe reports hard", async () => {
    hoisted.strength = 'hard';
    const res = await request(app())
      .patch('/config')
      .send({ agent: { allowedPaths: ['/allowed/dir'] } });
    expect(res.status).toBe(200);
    expect(res.body.agent.pathScopeStrength).toBe('hard');
  });

  it("returns 'soft' once a scope is configured when the mocked probe reports soft", async () => {
    hoisted.strength = 'soft';
    const res = await request(app())
      .patch('/config')
      .send({ agent: { disallowedPaths: ['/deny/dir'] } });
    expect(res.status).toBe(200);
    expect(res.body.agent.pathScopeStrength).toBe('soft');
  });

  it('recomputes pathScopeStrength on an unrelated agent PATCH while preserving previously-set paths', async () => {
    hoisted.strength = 'hard';
    await request(app())
      .patch('/config')
      .send({ agent: { allowedPaths: ['/allowed/dir'] } });

    const res = await request(app())
      .patch('/config')
      .send({ agent: { claudeUsePreset: false } });
    expect(res.status).toBe(200);
    expect(res.body.agent.allowedPaths).toEqual(['/allowed/dir']);
    expect(res.body.agent.pathScopeStrength).toBe('hard');
  });
});
