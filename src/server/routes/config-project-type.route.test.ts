/**
 * 2.1.77 — M57 `y47yl4xt` / `zy42cyj7` and M26 `ournm78e` (field `stały`): the
 * project's type is fixed through the API. A PATCH with another value is refused
 * with `PROJECT_TYPE_IMMUTABLE` and the file stays byte for byte; with the stored
 * value it succeeds and changes nothing in the file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath } from '../config.js';
import { configRouter } from './config.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import { STATIC_FIELD_REGISTRY } from '../settings/registry.js';
import { projectCapabilitySet } from '../project-types/capabilities.js';

describe('PATCH /config — projectType is fixed (2.1.77, M57)', () => {
  let dir: string;
  let file: string;

  const seed = (content: Record<string, unknown>) => {
    fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
    return fs.readFileSync(file, 'utf8');
  };
  const app = () =>
    express()
      .use(express.json())
      .use(configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry }));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-ptype-'));
    file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('declares projectType as a fixed field of M57 with default spec and PROJECT_TYPE_IMMUTABLE', () => {
    const d = STATIC_FIELD_REGISTRY.get('projectType');
    expect(d).toMatchObject({
      key: 'projectType',
      type: 'string',
      default: 'spec',
      apiWritable: 'fixed',
      fixedErrorCode: 'PROJECT_TYPE_IMMUTABLE',
      resumeLock: false,
      effect: 'none',
    });
  });

  it('GET /config returns the stored type, and spec when the file has no key', async () => {
    seed({ $schemaVersion: 4, name: 'X', projectType: 'skill' });
    expect((await request(app()).get('/config')).body.projectType).toBe('skill');
    seed({ $schemaVersion: 4, name: 'X' });
    expect((await request(app()).get('/config')).body.projectType).toBe('spec');
  });

  it('[ac:ac-patch-api-config-z-wartoscia-projectt] PATCH /api/config with a projectType other than the stored one is refused with a code, and the file stays unchanged', async () => {
    const before = seed({ $schemaVersion: 4, name: 'X', projectType: 'spec' });
    const res = await request(app()).patch('/config').send({ projectType: 'skill' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROJECT_TYPE_IMMUTABLE');
    expect(res.body.error.details).toEqual({ field: 'projectType' });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);

    // The refusal ends the WHOLE save: a field carried beside it is not written either.
    const mixed = await request(app()).patch('/config').send({ name: 'Renamed', projectType: 'writing-style' });
    expect(mixed.status).toBe(400);
    expect(mixed.body.error.code).toBe('PROJECT_TYPE_IMMUTABLE');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);

    // No key in the file means `spec`: another value is still a change of type.
    const absent = seed({ $schemaVersion: 4, name: 'X' });
    const res2 = await request(app()).patch('/config').send({ projectType: 'skill' });
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('PROJECT_TYPE_IMMUTABLE');
    expect(fs.readFileSync(file, 'utf8')).toBe(absent);
  });

  it('[ac:ac-patch-api-config-z-wartoscia-projectt-2] PATCH /api/config with the stored projectType succeeds and changes nothing in the file', async () => {
    const before = seed({ $schemaVersion: 4, name: 'X', projectType: 'skill' });
    const res = await request(app()).patch('/config').send({ projectType: 'skill' });
    expect(res.status).toBe(200);
    expect(res.body.projectType).toBe('skill');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);

    // Absent key = `spec`: sending `spec` is the stored value — no key is added.
    const absent = seed({ $schemaVersion: 4, name: 'X' });
    const res2 = await request(app()).patch('/config').send({ projectType: 'spec' });
    expect(res2.status).toBe(200);
    expect(res2.body.projectType).toBe('spec');
    expect(fs.readFileSync(file, 'utf8')).toBe(absent);

    // Beside another field, the same value leaves the type key as it was.
    seed({ $schemaVersion: 4, name: 'X', projectType: 'skill' });
    const res3 = await request(app()).patch('/config').send({ name: 'Y', projectType: 'skill' });
    expect(res3.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.name).toBe('Y');
    expect(onDisk.projectType).toBe('skill');
  });

  it('a projectType of the wrong wire type is a VALIDATION error pinned to the key', async () => {
    const before = seed({ $schemaVersion: 4, name: 'X' });
    const res = await request(app()).patch('/config').send({ projectType: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION', details: { field: 'projectType' } });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('PATCH /config — roots[] without multi-root (2.1.77, M01 kt5gesnm)', () => {
  let dir: string;
  const base = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };
  const appWith = (capabilities: string[]) =>
    express()
      .use(express.json())
      .use(
        configRouter({
          cwd: dir,
          skillRegistry: {} as unknown as SkillRegistry,
          capabilities: projectCapabilitySet(capabilities),
        }),
      );
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-multiroot-'));
    fs.mkdirSync(path.dirname(configPath(dir)), { recursive: true });
    fs.writeFileSync(configPath(dir), JSON.stringify({ $schemaVersion: 4, name: 'X', projectType: 'skill', roots: [base] }, null, 2) + '\n');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('[ac:ac-zapis-roots-z-drugim-wpisem-w-projekc] a roots[] write with a second entry in a `skill` project ends in a validation error, the file unchanged', async () => {
    const before = fs.readFileSync(configPath(dir), 'utf8');
    const res = await request(appWith(['skill-exposure']))
      .patch('/config')
      .send({ roots: [base, { id: 'notes', name: 'Notes', dir: 'notes', builtin: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.details).toEqual({ field: 'roots' });
    expect(fs.readFileSync(configPath(dir), 'utf8')).toBe(before);
    // The base root alone is still a valid write.
    const ok = await request(appWith(['skill-exposure'])).patch('/config').send({ roots: [base] });
    expect(ok.status).toBe(200);
  });

  it('GET /config answers the capability set the context factory passed', async () => {
    const res = await request(appWith(['skill-exposure'])).get('/config');
    expect(res.body.capabilities).toEqual(['skill-exposure']);
  });
});
