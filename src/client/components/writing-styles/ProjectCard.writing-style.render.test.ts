// @vitest-environment happy-dom
/**
 * 2.1.77 (M15 / L19, M52 `8zu57gsf`) — the `Writing style` element of the
 * `#project` settings card offers no style option for an attached Skill
 * project. The entry of a Skill project is a `contextual` entry of the skill
 * registry's `list()`, not a position of `listSelectable()`, so the server's
 * `GET /api/writing-styles` answer does not carry it — and the element maps that
 * answer's `available[]` one to one onto its options.
 *
 * The `available[]` fed to the card is the server's own answer: the real
 * `configRouter` over a registry with the `project-exposed` source wired the way
 * the project context wires it, the consumer attaching a Writing Style project
 * and a Skill project. The card is rendered through the real
 * `SettingsCardFrame`, assembled the way `/settings` assembles it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigResponse } from '../../lib/api.js';
import type { WritingStylesResponse } from '../../../shared/writing-styles.js';
import { normalizeSkillConfig, readConfig, writeConfig } from '../../../server/config.js';
import { configRouter } from '../../../server/routes/config.js';
import { projectCapabilitySet } from '../../../server/project-types/capabilities.js';
import { ProjectExposedSkillSource, workspaceExposedSkillAccess } from '../../../server/services/project-exposed-skills.js';
import { SkillRegistry } from '../../../server/services/skill-registry.js';
import type { ProjectRecord } from '../../../server/workspace/types.js';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
}));

import { settingsCards } from '../settings/SettingsPage.js';
import { SettingsCardFrame } from '../settings/SettingsCardFrame.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SPEC = ['briefs', 'entities', 'multi-root'];

const tmpDirs: string[] = [];
function dir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-project-card-style-'));
  tmpDirs.push(d);
  return d;
}

/**
 * The consumer `app` (a Specification) attaches, confirmed on this machine,
 * `house-style` (a Writing Style project) and `team-skill` (a Skill project).
 */
function serverWorkspace() {
  const cwds = { app: dir(), style: dir(), team: dir() };
  writeConfig(cwds.app, { name: 'App', skill: { uses: ['house-style', 'team-skill'] } });
  writeConfig(cwds.style, { name: 'Style', projectType: 'writing-style', skill: { name: 'house-style', description: 'The house writing style.' } });
  writeConfig(cwds.team, { name: 'Team', projectType: 'skill', skill: { name: 'team-skill', description: 'How the team works.' } });
  const projects: ProjectRecord[] = [
    { id: 'app', cwd: cwds.app, confirmedSkillUses: ['house-style', 'team-skill'] },
    { id: 'style', cwd: cwds.style, projectType: 'writing-style' },
    { id: 'team', cwd: cwds.team, projectType: 'skill' },
  ];
  const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
  registry.registerSource(
    new ProjectExposedSkillSource(
      'app',
      workspaceExposedSkillAccess({
        consumerId: 'app',
        readOwnSkill: () => normalizeSkillConfig(readConfig(cwds.app)),
        readWorkspaceProjects: () => projects,
        readProvider: async (id) => ({ entry: 'index.md', content: `# ${id}\n`, files: {} }),
      }),
    ),
  );
  const app = express()
    .use(express.json())
    .use(configRouter({ cwd: cwds.app, skillRegistry: registry, capabilities: projectCapabilitySet(SPEC) }));
  return { registry, app };
}

const CONFIG = {
  name: 'demo',
  description: null,
  roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
  writingStyle: null,
  writingStyleUnavailable: null,
  language: null,
  skill: { uses: ['house-style', 'team-skill'] },
  projectType: 'spec',
  capabilities: SPEC,
  $schemaVersion: 4,
  configHash: 'h',
} as unknown as ConfigResponse;

let host: HTMLDivElement;
let root: Root;
let writingStyles: WritingStylesResponse;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/api/writing-styles') ? writingStyles : url.includes('/api/spec-skills/exposed-projects') ? { data: [] } : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Renders the `#project` card; returns the `Writing style` select (the one whose null option is the default tone). */
async function renderWritingStyleSelect(): Promise<HTMLSelectElement> {
  const card = settingsCards('project', new Set(SPEC)).find((c) => c.decl.anchor === 'project');
  expect(card, 'the #project card exists').toBeDefined();
  expect(card!.elements.map((e) => e.id)).toContain('writing-style');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['config'], CONFIG);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(SettingsCardFrame, { card: card!, config: CONFIG })));
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  expect(host.textContent).toContain('Writing style');
  const select = [...host.querySelectorAll('select')].find((s) => s.options[0]?.textContent === '(none — default tone)');
  expect(select, 'the Writing style select is rendered').toBeDefined();
  return select!;
}

describe('#project card — the Writing style element and an attached Skill project (2.1.77)', () => {
  it('[ac:ac-element-writing-style-na-karcie-proje] the `Writing style` element of the #project card shows no style option for an attached Skill project', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, app } = serverWorkspace();
    // The Skill project does bring an entry into the server's registry — a contextual one.
    expect(registry.list()).toContainEqual(
      expect.objectContaining({ slug: 'team-skill', scope: 'contextual', source: 'project-exposed', project: 'team' }),
    );
    // The answer the element reads is the server's own GET /api/writing-styles.
    const res = await request(app).get('/writing-styles');
    expect(res.status).toBe(200);
    writingStyles = res.body as WritingStylesResponse;

    const select = await renderWritingStyleSelect();
    const values = [...select.options].map((o) => o.value);
    const labels = [...select.options].map((o) => o.textContent ?? '');
    // No option for the Skill project's entry — neither by value nor by its title.
    expect(values).not.toContain('team-skill');
    expect(labels.some((l) => l.includes('team-skill') || l.includes('Team'))).toBe(false);
    // The attached Writing Style project's style is offered, badged as an attached project.
    expect(values).toContain('house-style');
    expect(labels.find((_, i) => values[i] === 'house-style')).toMatch(/— attached project$/);
    // The options are exactly `None` plus the server's `available[]`.
    expect(values).toEqual(['', ...writingStyles.available.map((s) => s.slug)]);
  });
});
