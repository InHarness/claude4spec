import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath, type Config } from '../config.js';
import { configRouter } from './config.js';
import type { SkillRegistry } from '../services/skill-registry.js';

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
