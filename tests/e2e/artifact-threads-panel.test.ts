import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the shared artifact threads panel (0.1.139 — brief 0-1-138-to-0-1-139).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * Structurally out of Vitest's reach: `GET /api/artifacts/:kind/:path/threads`
 * is already covered against supertest (`routes/artifacts.test.ts`) and against
 * the DB (`services/chat.artifact-threads.test.ts`). What no unit test can see
 * is whether the panels those rows feed actually MOUNT — the plan page grew
 * three new panels in this release, and a component that throws on render still
 * leaves the endpoint returning a clean 200. Hence the console-error assertion:
 * it is the whole point of the file, not a garnish.
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
  if (!project) throw new Error('no project registered in this environment');
  await fetch(`${BASE}/api/projects/${project.id}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onboardingCompleted: true }),
  });
  return project;
}

async function firstArtifactPath(projectId: string, kind: 'plan' | 'brief'): Promise<string> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/artifacts/${kind}`);
  const { data } = (await res.json()) as { data: Array<{ path: string }> };
  const path = data[0]?.path;
  if (!path) throw new Error(`environment has no ${kind} to exercise — seed one first`);
  return path;
}

describe.skipIf(!BASE)('artifact threads panel', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  let planPath: string;
  let briefPath: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    planPath = await firstArtifactPath(project.id, 'plan');
    briefPath = await firstArtifactPath(project.id, 'brief');
  });
  afterAll(async () => {
    await browser?.close();
  });

  /** Opens a page while recording the two things a 200 response cannot rule out. */
  async function openWatched(url: string): Promise<{
    page: Page;
    consoleErrors: string[];
    badResponses: string[];
  }> {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    return { page, consoleErrors, badResponses };
  }

  it('the plan page mounts every panel with no console error and no 4xx/5xx', async () => {
    const { page, consoleErrors, badResponses } = await openWatched(
      `${BASE}/p/${project.id}/plans/${encodeURIComponent(planPath)}`,
    );

    // The header the multi-panel rebuild introduced.
    expect(await page.locator('header').first().innerText()).toMatch(/Plan v\d+/);

    for (const tab of ['Threads', 'History', 'Plan']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(500);
    }

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);
    await page.close();
  });

  it('"New conversation" attaches a thread and the panel lists it back', async () => {
    const url = `${BASE}/p/${project.id}/plans/${encodeURIComponent(planPath)}`;
    const { page, consoleErrors, badResponses } = await openWatched(url);

    await page.getByRole('button', { name: 'Threads', exact: true }).click();
    await page.waitForTimeout(400);
    const before = await page.locator('ul li button').count();

    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.waitForTimeout(1500);

    // Reload rather than trusting the optimistic cache — this asserts the row
    // came back from GET /api/artifacts/plan/:path/threads, not from local state.
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Threads', exact: true }).click();
    await expect.poll(() => page.locator('ul li button').count()).toBe(before + 1);
    // Row metadata the generic DTO carries (messageCount).
    expect(await page.locator('ul li button').first().innerText()).toMatch(/\d+ msg/);

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);
    await page.close();
  });

  /**
   * Regression: `PUT /api/artifacts/plan/:path/content` replaces the whole file,
   * but the tiptap editor only holds the body — so a Save that forwards the
   * editor's markdown verbatim arrives with NO frontmatter and is rejected as
   * mutating every immutable key. Vitest can't catch it: composing the payload
   * is the browser's job, and the endpoint is perfectly happy when called
   * correctly.
   */
  it('saving an edited plan body preserves frontmatter instead of 400ing IMMUTABLE_FIELD', async () => {
    const url = `${BASE}/p/${project.id}/plans/${encodeURIComponent(planPath)}`;
    const { page, consoleErrors, badResponses } = await openWatched(url);

    const before = await fetch(
      `${BASE}/api/projects/${project.id}/artifacts/plan/${encodeURIComponent(planPath)}`,
    ).then((r) => r.json() as Promise<{ data: { frontmatter: Record<string, unknown> } }>);

    const editor = page.locator('.prose-spec').first();
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' edited-by-e2e');

    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect.poll(() => save.isVisible()).toBe(true);
    await save.click();
    await page.waitForTimeout(1500);

    // The Save button disappears only once `dirtyContent` clears, i.e. on success.
    expect(await save.isVisible()).toBe(false);

    const after = await fetch(
      `${BASE}/api/projects/${project.id}/artifacts/plan/${encodeURIComponent(planPath)}`,
    ).then((r) => r.json() as Promise<{ data: { frontmatter: Record<string, unknown>; body: string } }>);

    expect(after.data.body).toContain('edited-by-e2e');
    // The immutable trio survived the round-trip.
    for (const key of ['type', 'created_at', 'created_by']) {
      expect(after.data.frontmatter[key]).toEqual(before.data.frontmatter[key]);
    }
    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);
    await page.close();
  });

  it('the brief detail page renders the same shared panel', async () => {
    const { page, consoleErrors, badResponses } = await openWatched(
      `${BASE}/p/${project.id}/briefs/${encodeURIComponent(briefPath)}`,
    );

    await page.getByRole('button', { name: 'Threads', exact: true }).click();
    await page.waitForTimeout(500);
    await expect
      .poll(() => page.getByRole('button', { name: 'New conversation', exact: true }).isVisible())
      .toBe(true);
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.waitForTimeout(500);

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);
    await page.close();
  });

  it('the bespoke plan threads route is retired and an unknown kind still 404s', async () => {
    const retired = await fetch(
      `${BASE}/api/projects/${project.id}/plans/${encodeURIComponent(planPath)}/threads`,
    );
    expect(retired.status).toBe(404);

    const unknownKind = await fetch(
      `${BASE}/api/projects/${project.id}/artifacts/bogus/${encodeURIComponent(planPath)}/threads`,
    );
    expect(unknownKind.status).toBe(404);
    expect(((await unknownKind.json()) as { error: { code: string } }).error.code).toBe(
      'UNKNOWN_ARTIFACT_KIND',
    );
  });
});
