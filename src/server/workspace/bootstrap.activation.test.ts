import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { WorkspaceRegistry } from './registry.js';
import { bootstrapProject, ensureWelcomePage } from './bootstrap.js';
import { configPath } from '../config.js';
import { configRouter } from '../routes/config.js';
import { BOOTSTRAP_TEMPLATE } from '../../bin/bootstrap-template.js';
import type { SkillRegistry } from '../services/skill-registry.js';

// Deterministic stand-in for the OS sandbox probe the config response reports, so
// the PATCH below does not depend on the host (same stand-in as config.route.test.ts).
vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    probePathScope: (...args: Parameters<typeof actual.probePathScope>) => ({
      ...actual.probePathScope(...args),
      strength: 'soft' as const,
    }),
  };
});

/**
 * 2.1.55 (M27 removed) — M01 project activation without the clone hand-off: the
 * welcome-page step is the sixth and has no clone exception, and the bootstrap no
 * longer reports whether it created `.gitignore` (the clone rollback was its only
 * consumer).
 */
describe('M01 project activation — welcome-page step, no clone', () => {
  let tmp: string;
  let cwd: string;
  let registry: WorkspaceRegistry;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-activation-'));
    cwd = path.join(tmp, 'project');
    registry = new WorkspaceRegistry(path.join(tmp, 'home'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const activate = () => bootstrapProject(registry, registry.selectOrCreate({ name: 'default' }), cwd);

  const writeConfig = (cfg: Record<string, unknown>) => {
    fs.mkdirSync(path.dirname(configPath(cwd)), { recursive: true });
    fs.writeFileSync(configPath(cwd), JSON.stringify(cfg));
  };

  /** The config router as the project context wires it: onboarding close runs the welcome step. */
  const app = () =>
    express()
      .use(express.json())
      .use(
        configRouter({
          cwd,
          skillRegistry: { isSelectable: () => true, unselectableReason: () => '' } as unknown as SkillRegistry,
          onOnboardingCompleted: (effectivePagesDir) => ensureWelcomePage(cwd, effectivePagesDir),
        }),
      );

  it('[ac:ac-swiezy-bootstrap-onboardingcompleted] a fresh bootstrap writes no pages/index.md; closing onboarding writes it on the effective pagesDir', async () => {
    const boot = activate();
    expect(boot.config.onboardingCompleted).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'pages', 'index.md'))).toBe(false);
    expect(fs.readdirSync(path.join(cwd, 'pages'))).toEqual([]);

    // Onboarding closes with a changed base-root dir in the same write.
    const res = await request(app())
      .patch('/config')
      .send({ roots: [{ id: 'pages', name: 'Pages', dir: 'spec', builtin: true }], onboardingCompleted: true });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(path.join(cwd, 'spec', 'index.md'), 'utf8')).toBe(BOOTSTRAP_TEMPLATE);
    // No orphan under the old address.
    expect(fs.existsSync(path.join(cwd, 'pages', 'index.md'))).toBe(false);
  });

  it('[ac:ac-swiezy-bootstrap-onboardingcompleted] the welcome step keeps the empty-directory condition: a non-empty pagesDir gets no index.md, and the step is idempotent', () => {
    writeConfig({ $schemaVersion: 4, name: 'p', roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }], onboardingCompleted: true });
    fs.mkdirSync(path.join(cwd, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'pages', 'existing.md'), '# Existing\n');
    activate();
    expect(fs.readdirSync(path.join(cwd, 'pages'))).toEqual(['existing.md']);

    fs.rmSync(path.join(cwd, 'pages', 'existing.md'));
    activate();
    activate();
    expect(fs.readdirSync(path.join(cwd, 'pages'))).toEqual(['index.md']);
    expect(fs.readFileSync(path.join(cwd, 'pages', 'index.md'), 'utf8')).toBe(BOOTSTRAP_TEMPLATE);
  });

  it('[ac:ac-swiezy-bootstrap-onboardingcompleted] a project without onboardingCompleted (from before onboarding) gets the welcome page at activation', () => {
    writeConfig({ $schemaVersion: 4, name: 'old', roots: [{ id: 'pages', name: 'Pages', dir: 'docs', builtin: true }] });
    const boot = activate();
    expect(boot.config.onboardingCompleted).toBe(true);
    expect(fs.readFileSync(path.join(cwd, 'docs', 'index.md'), 'utf8')).toBe(BOOTSTRAP_TEMPLATE);
    // The read does not write the field back.
    expect('onboardingCompleted' in (JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as object)).toBe(false);
  });

  it('[section:dsh8ezbz] activation has no clone hand-off: the result names only the project, its config and whether config.json was created', () => {
    const boot = activate();
    expect(Object.keys(boot).sort()).toEqual(['config', 'configCreated', 'configPath', 'project']);
  });

  it('[section:2qwi21mw] the managed .gitignore block is written without a created-vs-found report', () => {
    const fresh = activate();
    expect(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toContain('# claude4spec (auto-added)');
    expect(fresh).not.toHaveProperty('gitignoreCreated');

    // An existing user file is appended to, and the result is the same shape either way.
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n');
    const found = activate();
    expect(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8').startsWith('node_modules/\n')).toBe(true);
    expect(found).not.toHaveProperty('gitignoreCreated');
    expect(Object.keys(found).sort()).toEqual(Object.keys(fresh).sort());
  });
});
