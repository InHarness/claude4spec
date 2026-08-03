import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: Settings → Directories, the `plansDir` control (0.2.8 — C17).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * Out of Vitest's reach on purpose: whether the control actually RENDERS in the
 * section (a route test can only prove the server accepts the field), and
 * whether the collision rule reaches the user as a visible message rather than
 * a silent no-op. A green PATCH proves neither.
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

describe.skipIf(!BASE)('settings — Directories: plansDir (0.2.8)', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  let originalPlansDir: string;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await completeOnboarding(project.id);
    originalPlansDir = String((await readConfig(project.id)).plansDir ?? '.claude4spec/plans');

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
    // Leave the environment as we found it — other cases may share it.
    if (project) {
      await fetch(`${BASE}/api/projects/${project.id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plansDir: originalPlansDir }),
      }).catch(() => {});
    }
    await browser?.close();
  });

  /** The settings page renders several cards, each with its own Save — scope to this one. */
  const section = () => page.locator('#directories');
  const plansInput = () =>
    section().locator('label', { hasText: 'Plans directory' }).locator('input').first();
  const saveButton = () => section().getByRole('button', { name: 'Save' });

  it('renders a Plans directory control alongside the other artifact dirs', async () => {
    await expect.poll(() => plansInput().count()).toBeGreaterThan(0);
    await expect.poll(() => plansInput().inputValue()).toBe(originalPlansDir);
  });

  it('saves a new plansDir and persists it', async () => {
    const next = '.claude4spec/roadmap';
    await plansInput().fill(next);
    await saveButton().click();
    await expect.poll(async () => String((await readConfig(project.id)).plansDir), {
      timeout: 10_000,
    }).toBe(next);
  });

  it('refuses a plansDir colliding with briefsDir, with a visible message', async () => {
    const before = await readConfig(project.id);
    const briefsDir = String(before.briefsDir);
    const plansBefore = String(before.plansDir);
    await plansInput().fill(briefsDir);
    await expect.poll(() => section().getByText(/must differ/i).count(), { timeout: 5_000 }).toBeGreaterThan(0);
    // The rule is enforced before the request, not by a rejected round-trip: Save
    // is disabled, so clicking it cannot send the colliding value…
    await expect.poll(() => saveButton().isDisabled(), { timeout: 5_000 }).toBe(true);
    await saveButton().click({ force: true }).catch(() => {});
    // …and the persisted value is still exactly what it was before this case.
    expect(String((await readConfig(project.id)).plansDir)).toBe(plansBefore);
  });

  it('logged no console errors and no failed responses along the way', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
