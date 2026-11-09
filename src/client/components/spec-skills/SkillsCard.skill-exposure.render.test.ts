// @vitest-environment happy-dom
/**
 * 2.1.77 (M52 L17 `1osy2o5r`, L19 `0ay8qh6u`) — the `#skills` card of the
 * settings page by the project type's capability set. The four exposure
 * elements (`Skill name`, `Skill description`, `Entry page`, `Context types`)
 * require `skill-exposure`; `Used skill projects` (and the fork element) exist
 * in every type. The removed exposure toggle and scope choice are on no type's
 * card.
 *
 * The card is rendered through the real `SettingsCardFrame`, assembled the way
 * `/settings` assembles it (`settingsCards('project', capabilities)`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigResponse } from '../../lib/api.js';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
}));

import { settingsCards } from '../settings/SettingsPage.js';
import { SettingsCardFrame } from '../settings/SettingsCardFrame.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The capability sets of the host's types (M58 / M59). */
const SPEC = ['briefs', 'entities', 'multi-root'];
const SKILL = ['skill-exposure'];

const CONFIG = {
  name: 'demo',
  roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
  writingStyle: null,
  writingStyleUnavailable: null,
  skill: { uses: [] },
  $schemaVersion: 4,
  configHash: 'h',
} as unknown as ConfigResponse;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/api/spec-skills/exposed-projects')
        ? { data: [] }
        : url.includes('/api/writing-styles')
          ? { active: null, available: [] }
          : {};
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
});

/** Renders the `#skills` card of a project with that capability set; returns the card's text. */
async function renderSkillsCard(capabilities: string[], projectType: string): Promise<string> {
  const card = settingsCards('project', new Set(capabilities)).find((c) => c.decl.anchor === 'skills');
  expect(card, 'the #skills card exists in every type').toBeDefined();
  const config = { ...CONFIG, projectType, capabilities } as ConfigResponse;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['config'], config);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(SettingsCardFrame, { card: card!, config })));
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return host.textContent ?? '';
}

describe('#skills card by the project type (M52, 2.1.77)', () => {
  it('[ac:ac-karta-skills-projektu-typu-specyfikac] the #skills card of a Specification project has no `Skill name` element', async () => {
    const text = await renderSkillsCard(SPEC, 'spec');
    expect(text).not.toContain('Skill name');
    // None of the exposure elements: they all require `skill-exposure`.
    expect(text).not.toContain('Skill description');
    expect(text).not.toContain('Entry page');
    expect(text).not.toContain('Context types');
    // A Skill project's card has it — the element follows the capability.
    act(() => root.unmount());
    root = createRoot(host);
    expect(await renderSkillsCard(SKILL, 'skill')).toContain('Skill name');
  });

  it('[ac:ac-karta-skills-projektu-typu-specyfikac-2] the #skills card of a Specification project has the `Used skill projects` element', async () => {
    const text = await renderSkillsCard(SPEC, 'spec');
    expect(text).toContain('Used skill projects');
    // The list itself is rendered (rows from GET /api/spec-skills/exposed-projects — none here).
    expect(text).toContain('No project of this workspace is exposed as a skill.');
  });

  it('the removed exposure toggle and scope choice are on no type\'s card; the card carries no note, the Entry page its helper', async () => {
    for (const [caps, type] of [
      [SPEC, 'spec'],
      [SKILL, 'skill'],
      [SKILL, 'writing-style'],
    ] as const) {
      act(() => root.unmount());
      root = createRoot(host);
      const text = await renderSkillsCard([...caps], type);
      expect(text, type).not.toContain('Expose this project as a skill');
      expect(text, type).not.toMatch(/\bScope\b/);
    }
    const card = settingsCards('project', new Set(SKILL)).find((c) => c.decl.anchor === 'skills')!;
    expect(card.decl.description).toBeUndefined();
    expect(card.elements.find((e) => e.id === 'skill-entry')!.help).toBe('Projects that use this one read it live and read-only.');
    expect(card.elements.map((e) => e.id)).not.toContain('skill-exposed');
    expect(card.elements.map((e) => e.id)).not.toContain('skill-scope');
  });
});
