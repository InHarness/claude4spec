import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: Settings → Agent, the Claude Code preset toggle (0.2.112).
 *
 * Runs against a LIVE app (`C4S_E2E_BASE_URL`, normally an env-runner
 * environment); skips without it.
 *
 * The default flipped from ON to OFF with no migration, so a project whose
 * config.json never carried `agent.claudeUsePreset` must render the checkbox
 * UNticked — a route test proves the server answers `false`, only the rendered
 * control proves the client did not default the other way — and must show the
 * regression note, which is a sentence a user reads and nothing below the UI
 * can assert.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
}

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

async function patchConfig(projectId: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH config failed: ${res.status}`);
}

describe.skipIf(!BASE)('settings — Agent: Claude Code preset off by default (0.2.112)', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await patchConfig(project.id, { onboardingCompleted: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`);
    });
    await page.goto(`${BASE}/p/${project.id}/settings`, { waitUntil: 'networkidle' });
  });

  afterAll(async () => {
    await browser?.close();
  });

  const section = () => page.locator('#agent');
  const presetRow = () =>
    section().locator('label', { hasText: 'Append the Claude Code preset to the system prompt' }).first();
  const presetCheckbox = () => presetRow().locator('input[type="checkbox"]').first();

  it('GET config reports claudeUsePreset false on a project that never set it', async () => {
    const res = await fetch(`${BASE}/api/projects/${project.id}/config`);
    const cfg = (await res.json()) as { agent: { claudeUsePreset: boolean } };
    expect(cfg.agent.claudeUsePreset).toBe(false);
  });

  it('renders the toggle unchecked, with the new helper text', async () => {
    await expect.poll(() => presetCheckbox().count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => presetCheckbox().isChecked()).toBe(false);
    await expect
      .poll(() => presetRow().innerText())
      .toContain("Off by default — the agent receives only the project's prompt.");
  });

  it('shows the regression note: off by default, existing projects and running threads included', async () => {
    const note = section().getByTestId('claude-preset-regression-note');
    await expect.poll(() => note.count()).toBe(1);
    const text = await note.innerText();
    expect(text).toMatch(/now off by default/);
    expect(text).toMatch(/existing projects/);
    expect(text).toMatch(/next turn/);
  });

  it('ticking the box persists an explicit true, and unticking restores false', async () => {
    // A controlled checkbox: it flips when the config query refreshes, not on
    // the click itself — so click and poll rather than check()/uncheck().
    await presetCheckbox().click();
    await expect
      .poll(async () => {
        const res = await fetch(`${BASE}/api/projects/${project.id}/config`);
        return ((await res.json()) as { agent: { claudeUsePreset: boolean } }).agent.claudeUsePreset;
      })
      .toBe(true);
    // The control is disabled while its PATCH is in flight — wait it out.
    await expect.poll(() => presetCheckbox().isEnabled()).toBe(true);
    await expect.poll(() => presetCheckbox().isChecked()).toBe(true);
    await presetCheckbox().click();
    await expect
      .poll(async () => {
        const res = await fetch(`${BASE}/api/projects/${project.id}/config`);
        return ((await res.json()) as { agent: { claudeUsePreset: boolean } }).agent.claudeUsePreset;
      })
      .toBe(false);
    await expect.poll(() => presetCheckbox().isChecked()).toBe(false);
  });

  it('logs no console errors and no failed responses', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
