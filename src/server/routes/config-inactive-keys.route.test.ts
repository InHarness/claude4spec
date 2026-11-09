/**
 * 2.1.77 — M26 `ournm78e`: the GET/PATCH /config answer carries ACTIVE keys only.
 * An inactive key is stripped at its RESPONSE path, which is not always its file
 * path: `onboardingCompleted` lies at the file's top level but is answered as
 * `onboarding.completed`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { configPath } from '../config.js';
import { configRouter, responsePath, stripInactiveKeys } from './config.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import { STATIC_FIELD_REGISTRY } from '../settings/registry.js';
import { fieldPath, getPath, hasPath } from '../settings/field-registry.js';

describe('GET /config — inactive keys stripped by response path (2.1.77, M26)', () => {
  let dir: string;
  const app = () =>
    express()
      .use(express.json())
      .use(configRouter({ cwd: dir, skillRegistry: { isSelectable: () => true } as unknown as SkillRegistry }));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-inactive-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ $schemaVersion: 4, name: 'X', description: 'D', onboardingCompleted: true }, null, 2) + '\n',
    );
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('maps the non-mirrored file key onboardingCompleted to the response path onboarding.completed', async () => {
    const decl = STATIC_FIELD_REGISTRY.get('onboardingCompleted')!;
    expect(decl).toBeDefined();
    const body = (await request(app()).get('/config')).body as Record<string, unknown>;
    // The file path is not where the response carries the value…
    expect(hasPath(body, fieldPath(decl))).toBe(false);
    // …the response path is.
    expect(responsePath('onboardingCompleted', STATIC_FIELD_REGISTRY)).toEqual(['onboarding', 'completed']);
    expect(getPath(body, responsePath('onboardingCompleted', STATIC_FIELD_REGISTRY))).toBe(true);
  });

  it('an inactive onboardingCompleted is not returned, and a mirrored inactive key is stripped too', async () => {
    const body = (await request(app()).get('/config')).body as Record<string, unknown>;
    expect(getPath(body, ['onboarding', 'completed'])).toBe(true);
    expect(body.description).toBe('D');

    stripInactiveKeys(body, ['onboardingCompleted', 'description'], STATIC_FIELD_REGISTRY);

    expect(hasPath(body, ['onboarding', 'completed'])).toBe(false);
    expect(hasPath(body, ['description'])).toBe(false);
    // Active keys stay as they were.
    expect(body.name).toBe('X');
  });

  it('a mirrored nested key is answered at its file path', () => {
    expect(responsePath('agent.allowedPaths', STATIC_FIELD_REGISTRY)).toEqual(['agent', 'allowedPaths']);
    const body: Record<string, unknown> = { agent: { allowedPaths: ['a'], disallowedPaths: [] } };
    stripInactiveKeys(body, ['agent.allowedPaths'], STATIC_FIELD_REGISTRY);
    expect(body).toEqual({ agent: { disallowedPaths: [] } });
  });
});
