import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import express from 'express';
import { configRouter } from '../../../src/server/routes/config.js';
import { configPath } from '../../../src/server/config.js';
import type { SkillRegistry } from '../../../src/server/services/skill-registry.js';
import type { PluginSettingsSection } from '../../../src/shared/plugin-host/manifest.js';

const SECTIONS: PluginSettingsSection[] = [
  {
    name: '@c4s/plugin-foo',
    version: '0.1.0',
    fields: [
      { key: 'enableBadge', label: 'Enable badge', control: 'toggle', kind: 'hot-reload', default: true },
      { key: 'apiBase', label: 'API base', control: 'text', kind: 'executive', default: '' },
    ],
  },
];

const skillStub = {
  isSelectable: () => false,
  listSelectable: () => [],
} as unknown as SkillRegistry;

describe('M33 phase 3 — PATCH /config plugins namespace', () => {
  let dir: string;
  let onContextConfigChanged: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfgapi-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'X' }));
    onContextConfigChanged = vi.fn();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function app() {
    const a = express();
    a.use(express.json());
    a.use(
      configRouter({
        cwd: dir,
        skillRegistry: skillStub,
        onContextConfigChanged,
        pluginSettingsSections: () => SECTIONS,
      }),
    );
    return a;
  }

  it('persists + deep-merges a plugins write and echoes it back', async () => {
    await request(app())
      .patch('/config')
      .send({ plugins: { '@c4s/plugin-foo': { enableBadge: false } } })
      .expect(200);
    const res = await request(app())
      .patch('/config')
      .send({ plugins: { '@c4s/plugin-foo': { apiBase: 'https://x' } } })
      .expect(200);
    expect(res.body.plugins['@c4s/plugin-foo']).toEqual({ enableBadge: false, apiBase: 'https://x' });
  });

  it('a hot-reload-only field write does NOT invalidate the context', async () => {
    await request(app())
      .patch('/config')
      .send({ plugins: { '@c4s/plugin-foo': { enableBadge: false } } })
      .expect(200);
    expect(onContextConfigChanged).not.toHaveBeenCalled();
  });

  it('an executive field write invalidates the context (rebuild)', async () => {
    await request(app())
      .patch('/config')
      .send({ plugins: { '@c4s/plugin-foo': { apiBase: 'https://y' } } })
      .expect(200);
    expect(onContextConfigChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-object plugins payload', async () => {
    const res = await request(app()).patch('/config').send({ plugins: 42 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});
