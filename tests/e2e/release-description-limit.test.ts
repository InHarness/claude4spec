import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the create-release dialog under the 500-character description limit
 * (0.2.112). Live app only (`C4S_E2E_BASE_URL`); skips without it.
 *
 * Only the REFUSAL path is driven here, on purpose: it creates nothing, so the
 * environment is left exactly as found for the other suites. The accepting
 * boundary (exactly 500 code points) is covered by the Vitest service tests.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

async function firstProjectId(): Promise<string> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: { id: string }[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project.id;
}

describe.skipIf(!BASE)('releases — description at most 500 characters (0.2.112)', () => {
  let browser: Browser;
  let page: Page;
  let projectId: string;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const name = `e2e-desc-limit-${Date.now()}`;

  beforeAll(async () => {
    browser = await chromium.launch();
    projectId = await firstProjectId();
    await fetch(`${BASE}/api/projects/${projectId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`);
    });
    await page.goto(`${BASE}/p/${projectId}/releases`, { waitUntil: 'networkidle' });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('REST refuses 501 characters with 400 RELEASE_DESCRIPTION_TOO_LONG', async () => {
    const res = await fetch(`${BASE}/api/projects/${projectId}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: 'ż'.repeat(501) }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RELEASE_DESCRIPTION_TOO_LONG');
  });

  it('the dialog counts characters and refuses an over-long description without creating a release', async () => {
    await page.getByRole('button', { name: /Create release/ }).first().click();
    const dialog = page.locator('form', { hasText: 'Description (required)' });
    await expect.poll(() => dialog.count(), { timeout: 15_000 }).toBe(1);
    await dialog.locator('input').first().fill(name);
    await dialog.locator('textarea').fill('ż'.repeat(501));
    await expect.poll(() => dialog.getByTestId('release-description-counter').innerText()).toBe('501 / 500');
    await dialog.locator('button[type="submit"]').click();
    await expect.poll(() => dialog.innerText()).toContain('at most 500 characters');

    const list = await fetch(`${BASE}/api/projects/${projectId}/releases`);
    const { releases } = (await list.json()) as { releases: { name: string }[] };
    const names = releases.map((r) => r.name);
    expect(names).not.toContain(name);
  });

  it('logs no console errors and no failed responses — the REST 400 above is sent by the test, not the page', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
