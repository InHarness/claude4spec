import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the release detail route is `/releases/:name` (2.1.11) — the release NAME,
 * percent-encoded in one segment, never an id. Live app only (`C4S_E2E_BASE_URL`);
 * skips without it.
 *
 * Creates two releases (a digit-only name and one carrying `/`); the second is
 * the latest, so its name is editable inline and the rename can be driven.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

async function firstProjectId(): Promise<string> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: { id: string }[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project.id;
}

describe.skipIf(!BASE)('releases — detail addressed by name (2.1.11)', () => {
  let browser: Browser;
  let page: Page;
  let projectId: string;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const stamp = Date.now();
  const digitName = String(stamp);
  const slashName = `e2e/by-name-${stamp}`;
  const renamed = `e2e-renamed-${stamp}`;

  async function createRelease(name: string): Promise<void> {
    const res = await fetch(`${BASE}/api/projects/${projectId}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: 'e2e: detail addressed by name' }),
    });
    expect(res.status).toBe(201);
  }

  const detailUrl = (name: string) => `${BASE}/p/${projectId}/releases/${encodeURIComponent(name)}`;
  const nameInput = () => page.locator('input[title^="Click to rename"]');

  beforeAll(async () => {
    browser = await chromium.launch();
    projectId = await firstProjectId();
    await fetch(`${BASE}/api/projects/${projectId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    await createRelease(digitName);
    await createRelease(slashName);
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`);
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('/releases/<digits> opens the release NAMED by those digits', async () => {
    await page.goto(detailUrl(digitName), { waitUntil: 'networkidle' });
    await expect.poll(() => page.locator('h2', { hasText: digitName }).count(), { timeout: 15_000 }).toBe(1);
  });

  it('/releases/<name with a slash, percent-encoded> opens that release', async () => {
    await page.goto(detailUrl(slashName), { waitUntil: 'networkidle' });
    await expect.poll(() => nameInput().inputValue(), { timeout: 15_000 }).toBe(slashName);
  });

  it('an inline rename moves the open route to the new name; the old name is unknown afterwards', async () => {
    const input = nameInput();
    await input.fill(renamed);
    await input.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe(
      `/p/${projectId}/releases/${encodeURIComponent(renamed)}`,
    );
    await expect.poll(() => nameInput().inputValue()).toBe(renamed);

    const old = await fetch(`${BASE}/api/projects/${projectId}/releases/${encodeURIComponent(slashName)}`);
    expect(old.status).toBe(404);

    await page.goto(detailUrl(slashName), { waitUntil: 'networkidle' });
    await expect.poll(() => page.getByText('Release not found.').count(), { timeout: 15_000 }).toBe(1);
  });

  it('logs no console errors and no failed responses besides the deliberate unknown-name visit', () => {
    const oldNameSegment = `/releases/${encodeURIComponent(slashName)}`;
    expect(failedResponses.filter((r) => !r.includes(oldNameSegment))).toEqual([]);
    // The browser reports the deliberate 404 fetch as a console error, too.
    expect(consoleErrors.filter((e) => !/404|Not Found/i.test(e))).toEqual([]);
  });
});
