import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: Settings → Directories and Agent → "Always excluded" (2.1.8).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * 2.1.8: the artifact directories are fixed system roots registered in code.
 * The Directories card carries ONE element, Roots, which never lists a system
 * root; a new root whose id would be a system root's is refused under its name
 * field; the Agent card's "Always excluded" list is derived from the registry.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

/** `RootLayout` redirects every project route to /onboarding until this is set. */
async function completeOnboarding(projectId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onboardingCompleted: true }),
  });
  if (!res.ok) throw new Error(`failed to complete onboarding: ${res.status}`);
}

async function readConfig(projectId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/config`);
  return (await res.json()) as Record<string, unknown>;
}

describe.skipIf(!BASE)('settings — Directories and Always excluded (2.1.8)', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await completeOnboarding(project.id);

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

  /** The settings page renders several cards, each with its own Save — scope to this one. */
  const section = () => page.locator('#directories');

  it('the config response carries no artifact directory keys', async () => {
    const cfg = await readConfig(project.id);
    for (const key of ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir']) {
      expect(cfg).not.toHaveProperty(key);
    }
    for (const root of cfg.roots as Array<Record<string, unknown>>) {
      expect(Object.keys(root).sort()).toEqual(['builtin', 'dir', 'id', 'name']);
    }
  });

  it('[ac:ac-lista-elementu-roots-na-karcie-direct] the Directories card shows Roots only — no artifact directory fields, no system roots', async () => {
    await expect.poll(() => section().getByText('Roots', { exact: true }).count()).toBeGreaterThan(0);
    for (const label of ['Plans directory', 'Briefs directory', 'Patches directory', 'Entities directory', 'Releases directory']) {
      expect(await section().getByText(label, { exact: true }).count()).toBe(0);
    }
    const text = await section().innerText();
    for (const dir of ['.claude4spec/plans', '.claude4spec/briefs', '.claude4spec/patches', '.claude4spec/entities', '.claude4spec/releases']) {
      expect(text).not.toContain(dir);
    }
  });

  it('refuses a new root whose id is a system root id, under the name field', async () => {
    const name = section().locator('input[placeholder="e.g. Guides"]');
    await name.fill('Plans');
    await section().getByRole('button', { name: 'Add', exact: true }).click();
    await expect
      .poll(() => section().getByText(/reserved for a system root/i).count(), { timeout: 5_000 })
      .toBeGreaterThan(0);
    // Nothing was saved.
    const cfg = await readConfig(project.id);
    expect((cfg.roots as Array<{ id: string }>).some((r) => r.id === 'plans')).toBe(false);
  });

  it('Always excluded lists the five system root dirs', async () => {
    const list = page.getByTestId('always-excluded');
    await expect.poll(() => list.count()).toBeGreaterThan(0);
    const text = await list.innerText();
    for (const dir of ['.claude4spec/plans', '.claude4spec/briefs', '.claude4spec/patches', '.claude4spec/entities', '.claude4spec/releases']) {
      expect(text).toContain(dir);
    }
  });

  it('logged no console errors and no failed responses along the way', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
