/**
 * 2.1.77 — the keys of the capability `entities` (M13 `o4ju2d7m`: `entities`,
 * `elementsMenu[]`; M19 `6tdzzl38`: `consistency.*`) in a project whose type
 * lacks it (`skill`). M26 `hozcm4w5`: the type is settled first, then the keys
 * — the `readConfig` normalizer skips an inactive key, `writeConfig` keeps it in
 * the file untouched, GET does not return it, PATCH skips it without an error.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath, readConfig } from '../config.js';
import { configRouter } from './config.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import { installInactiveConfigKeys } from '../settings/inactive-config-keys.js';
import { hostProjectTypeRegistry } from '../project-types/registry.js';
import { projectCapabilitySet } from '../project-types/capabilities.js';

const capsOf = (type: string) => projectCapabilitySet(hostProjectTypeRegistry().get(type)!.capabilities);

/** The entity-capability keys as a hand-edited file carries them — odd spacing of values is irrelevant, the parsed values are compared. */
const ENTITY_KEYS = {
  entities: ['endpoint', 'not-installed-yet'],
  elementsMenu: [{ group: 'API', types: ['endpoint'] }, { type: 'dto', hidden: true }],
  consistency: { requireAcCoverage: 'warn', requireModuleAc: 'error' },
};

describe('config.json keys of the capability `entities` in a project without it (2.1.77)', () => {
  let dir: string;
  const app = (type: string) =>
    express()
      .use(express.json())
      .use(
        configRouter({
          cwd: dir,
          skillRegistry: { isSelectable: () => true } as unknown as SkillRegistry,
          capabilities: capsOf(type),
        }),
      );
  const writeFile = (content: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
  };
  const fileJson = () => JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;

  beforeAll(() => {
    installInactiveConfigKeys();
  });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-entities-cap-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the type `skill` lacks `entities` and `spec` has it — the premise of the tests below', () => {
    expect(capsOf('skill').has('entities')).toBe(false);
    expect(capsOf('spec').has('entities')).toBe(true);
  });

  it('[ac:ac-get-api-config-w-projekcie-bez-mozliw] GET /api/config in a project without `entities` does not return the keys `entities` and `elementsMenu` present in config.json', async () => {
    writeFile({ $schemaVersion: 4, projectType: 'skill', name: 'Review', ...ENTITY_KEYS });
    const res = await request(app('skill')).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Review');
    expect(res.body).not.toHaveProperty('entities');
    expect(res.body).not.toHaveProperty('elementsMenu');
    // The same file in a project WITH the capability returns the key.
    writeFile({ $schemaVersion: 4, projectType: 'spec', name: 'Review', ...ENTITY_KEYS });
    const spec = await request(app('spec')).get('/config');
    expect(spec.body.entities).toEqual(ENTITY_KEYS.entities);
  });

  it('[ac:ac-patch-api-config-z-kluczem-mozliwosci] PATCH /api/config with `entities` in a project without the capability succeeds and leaves the value of the key in the file unchanged', async () => {
    writeFile({ $schemaVersion: 4, projectType: 'skill', name: 'Review', ...ENTITY_KEYS });
    const res = await request(app('skill')).patch('/config').send({ entities: ['dto'], name: 'Renamed' });
    expect(res.status).toBe(200);
    const file = fileJson();
    // The active key was written…
    expect(file.name).toBe('Renamed');
    // …the inactive one was skipped, its value as before.
    expect(file.entities).toEqual(ENTITY_KEYS.entities);
    expect(res.body).not.toHaveProperty('entities');
  });

  it('[ac:ac-klucz-config-json-nalezacy-do-mozliwo] a config.json key of a capability the project type lacks stays in the file untouched after a settings save', async () => {
    // An `elementsMenu` that breaks the key's own rules (duplicate slug) — the
    // normalizer never reads it in a project without the capability.
    const menu = [{ type: 'endpoint' }, { type: 'endpoint' }];
    writeFile({ $schemaVersion: 4, projectType: 'skill', name: 'Review', ...ENTITY_KEYS, elementsMenu: menu });
    const before = fileJson();

    // The normalizer skipped the keys: no `entities` in the normalized view.
    expect(readConfig(dir).entities).toBeUndefined();

    const res = await request(app('skill')).patch('/config').send({ description: 'Saved from the settings page' });
    expect(res.status).toBe(200);
    const after = fileJson();
    expect(after.description).toBe('Saved from the settings page');
    // Every key of the missing capability, as written, value for value and serialized form for serialized form.
    for (const key of ['entities', 'elementsMenu', 'consistency'] as const) {
      expect(after[key], key).toEqual(before[key]);
      expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
    }
  });
});
