import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath } from '../config.js';
import { configRouter } from '../routes/config.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import { FieldRegistrationError, FieldRegistry, checkFieldType, type FieldDeclaration } from './field-registry.js';
import { STATIC_FIELD_REGISTRY, buildFieldRegistry } from './registry.js';

const field = (key: string, owner: string): FieldDeclaration => ({
  key,
  owner,
  type: 'boolean',
  default: false,
  effect: 'per-operation',
  resumeLock: false,
  apiWritable: true,
});

describe('field registry — one declarant per key (0.2.113)', () => {
  it('a key declared by two modules is a registration error naming both', () => {
    const registry = new FieldRegistry().register(field('git.enabled', 'git-sync'));
    expect(() => registry.register(field('git.enabled', 'someone-else'))).toThrow(FieldRegistrationError);
    expect(() => registry.register(field('git.enabled', 'someone-else'))).toThrow(/git-sync.*someone-else/);
  });

  it('a key overlapping an ancestor or a descendant leaf is a registration error', () => {
    const registry = new FieldRegistry().register(field('git.commitTarget.mode', 'git-sync'));
    expect(() => registry.register(field('git.commitTarget', 'other'))).toThrow(FieldRegistrationError);
  });

  it('the assembled registry builds — no core field has two declarants', () => {
    expect(() => buildFieldRegistry()).not.toThrow();
  });

  it('[section:vm9rajvn] the registry is the sum of the modules\' field tables only — no plugin-contributed field, no reserved plugins.<package> namespace', () => {
    const registry = buildFieldRegistry({ knownEntityTypes: () => ['endpoint'] });
    const keys = registry.list().map((d) => d.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => k === 'plugins' || k.startsWith('plugins.'))).toEqual([]);
    expect(registry.list().filter((d) => (d.path ?? d.key.split('.'))[0] === 'plugins')).toEqual([]);
    // Every declarant is a module of the layer; the same set the static registry holds.
    expect(new Set(keys)).toEqual(new Set(STATIC_FIELD_REGISTRY.list().map((d) => d.key)));
    // One declarant per key: a duplicate between two modules is a registration error.
    const dup = registry.list()[0]!;
    expect(() => buildFieldRegistry().register({ ...dup, owner: 'another-module' })).toThrow(FieldRegistrationError);
  });

  it('[section:alfjoj17] the registry is assembled from the declarations on every call — no shared instance, and nothing taken from the plugin pool', () => {
    const a = buildFieldRegistry();
    const b = buildFieldRegistry({ knownEntityTypes: () => ['endpoint'] });
    expect(a).not.toBe(b);
    expect(a).not.toBe(STATIC_FIELD_REGISTRY);
    expect(a.list().map((d) => d.key)).toEqual(b.list().map((d) => d.key));
    expect(a.list().map((d) => d.key)).toEqual(STATIC_FIELD_REGISTRY.list().map((d) => d.key));
    expect(a.list().some((d) => d.key.startsWith('plugins.'))).toBe(false);
  });

  it('derives the rebuild and resume-lock sets from the declarations', () => {
    // 2.1.8: the artifact `*Dir` keys are gone — system roots are code-registered.
    expect(new Set(STATIC_FIELD_REGISTRY.contextRebuildKeys())).toEqual(
      new Set(['roots', 'entities', 'remoteApiUrl']),
    );
    expect(new Set(STATIC_FIELD_REGISTRY.resumeLockedKeys())).toEqual(
      new Set(['agent.allowedPaths', 'agent.disallowedPaths', 'agent.disableDirectFilesystemAccess']),
    );
    for (const k of ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir']) {
      expect(STATIC_FIELD_REGISTRY.get(k)).toBeUndefined();
    }
  });

  it('consistency.* is declared but not writable through the API', () => {
    expect(STATIC_FIELD_REGISTRY.get('consistency.requireAcCoverage')?.apiWritable).toBe(false);
    expect(STATIC_FIELD_REGISTRY.get('consistency.requireModuleAc')?.apiWritable).toBe(false);
  });

  it('stage 1 names the key and the expected type', () => {
    expect(checkFieldType('agent.allowedPaths', 'string[]', [1])).toBe('agent.allowedPaths must be string[]');
    expect(checkFieldType('x', { enum: ['a', 'b'] }, 'c')).toBe("x must be 'a' | 'b'");
    expect(checkFieldType('x', 'string|null', null)).toBeNull();
  });
});

describe('PATCH /config on the field registry (0.2.113)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-registry-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'test' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const onDisk = () => JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;
  const app = (extra: Partial<Parameters<typeof configRouter>[0]> = {}) =>
    express()
      .use(express.json())
      .use(
        configRouter({
          cwd: dir,
          skillRegistry: {} as unknown as SkillRegistry,
          ...extra,
        }),
      );

  it('port/mode are plain unknown keys now — ignored, not a 400', async () => {
    const res = await request(app()).patch('/config').send({ port: 4000, mode: 'x', name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
    expect(onDisk()).not.toHaveProperty('port');
    expect(onDisk()).not.toHaveProperty('mode');
  });

  it('consistency.* sent through the API is dropped silently', async () => {
    const res = await request(app()).patch('/config').send({ consistency: { requireAcCoverage: 'error' } });
    expect(res.status).toBe(200);
    expect(onDisk()).not.toHaveProperty('consistency');
  });

  it('remoteApiUrl is not API-writable (the open decision keeps it hand-edited)', async () => {
    await request(app()).patch('/config').send({ remoteApiUrl: 'https://example.com' }).expect(200);
    expect(onDisk()).not.toHaveProperty('remoteApiUrl');
  });

  it('a rejection is pinned to the key it concerns', async () => {
    const res = await request(app()).patch('/config').send({ agent: { allowedPaths: 'nope' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION',
      message: 'agent.allowedPaths must be string[]',
      details: { field: 'agent.allowedPaths' },
    });
  });

  it('a container in the wrong shape is a type error on the container', async () => {
    const res = await request(app()).patch('/config').send({ git: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('git');
  });

  it('one rejected key rejects the whole request — nothing is written', async () => {
    const res = await request(app()).patch('/config').send({ name: 'Other', agent: { claudeUsePreset: 'yes' } });
    expect(res.status).toBe(400);
    expect(onDisk().name).toBe('test');
  });

  it('a root overlapping a system root is rejected by the cross-field rule, pinned to roots', async () => {
    const res = await request(app())
      .patch('/config')
      .send({
        roots: [
          { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
          { id: 'rel', name: 'Rel', dir: '.claude4spec/releases/x', builtin: false },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/'rel' overlaps write-target 'releases'/);
    expect(res.body.error.details.field).toBe('roots');
  });

  it('a legacy *Dir key is an unknown key now — ignored, not a 400', async () => {
    const res = await request(app()).patch('/config').send({ briefsDir: '.claude4spec/entities/briefs' });
    expect(res.status).toBe(200);
    expect(onDisk()).not.toHaveProperty('briefsDir');
  });

  it('an unknown entity slug is saved with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app({ knownEntityTypes: () => ['endpoint'] }))
      .patch('/config')
      .send({ entities: ['endpoint', 'nope'] });
    expect(res.status).toBe(200);
    expect(res.body.entities).toEqual(['endpoint', 'nope']);
    expect(res.body.warnings?.[0]).toMatch(/"nope"/);
    expect(warn.mock.calls.flat().join('\n')).toMatch(/unknown type/);
  });

  it('[section:vm9rajvn] a `plugins` body is an unknown key now — dropped silently (even in a wrong shape), nothing written under plugins', async () => {
    const res = await request(app())
      .patch('/config')
      .send({ name: 'Renamed', plugins: { '@c4s/plugin-foo': { enableBadge: 'yes' } } });
    expect(res.status).toBe(200);
    expect(onDisk().name).toBe('Renamed');
    expect(onDisk()).not.toHaveProperty('plugins');
    const odd = await request(app()).patch('/config').send({ plugins: 42 });
    expect(odd.status).toBe(200);
    expect(onDisk()).not.toHaveProperty('plugins');
  });
});
