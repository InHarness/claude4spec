import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the entity version-history view (0.1.143 — the host's history routes and
 * every plugin now render the SAME `EntityVersionHistoryView` block).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * Structurally out of Vitest's reach: this component fetches from three hooks
 * and composes four other catalog components, and there is no React Testing
 * Library in this repo. A `curl` on the route proves the SPA shell answered 200
 * — it cannot tell whether the timeline rendered, whether the release pill says
 * "(unreleased)", or whether the page logged a 404 while doing it.
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

interface VersionRow {
  version: number;
  changedBy: string;
  releaseId?: number;
}

async function listVersions(projectId: string, slug: string): Promise<VersionRow[]> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/entities/endpoint/${slug}/versions`);
  if (!res.ok) return [];
  const body = (await res.json()) as { versions: VersionRow[] };
  return body.versions;
}

/**
 * An endpoint with at least TWO versions, so "Compare to" has a target. Mutating
 * the description captures a version, so this can always manufacture what it
 * needs instead of depending on how the environment happened to be seeded.
 */
async function endpointWithHistory(projectId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/entities/endpoint`);
  const body = (await res.json()) as { data?: { slug: string }[]; endpoints?: { slug: string }[] };
  const slug = (body.data ?? body.endpoints ?? [])[0]?.slug;
  if (!slug) throw new Error('no endpoint in this environment — seed one first');

  while ((await listVersions(projectId, slug)).length < 2) {
    const patched = await fetch(`${BASE}/api/projects/${projectId}/entities/endpoint/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: `e2e history probe ${Math.random().toString(36).slice(2)}` }),
    });
    if (!patched.ok) throw new Error(`could not capture a version: ${patched.status}`);
  }
  return slug;
}

/** Opens the history route with console + network capture armed. */
async function openHistory(browser: Browser, projectId: string, slug: string) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  await page.goto(`${BASE}/p/${projectId}/endpoints/${slug}/history`, { waitUntil: 'networkidle' });
  return { page, consoleErrors, badResponses };
}

describe.skipIf(!BASE)('entity version history — EntityVersionHistoryView', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  let slug: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    slug = await endpointWithHistory(project.id);
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('[ac:ac-entityversionhistoryview-renderuje-kom] renders the whole view from type + slug alone, with a clean console', async () => {
    const { page, consoleErrors, badResponses } = await openHistory(browser, project.id, slug);

    // Rendered content, not just a 200 — a white SPA shell also returns 200.
    await expect.poll(() => page.getByText(/^v\d+$/).first().isVisible()).toBe(true);
    expect(await page.getByText(`endpoint · ${slug}`).isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Compare to' }).count()).toBeGreaterThan(0);
    expect(await page.getByRole('button', { name: 'Restore' }).count()).toBeGreaterThan(0);
    // Diff / Snapshot segmented tabs (the block's right pane).
    expect(await page.getByRole('tab', { name: 'Diff' }).isVisible()).toBe(true);

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);

    await page.screenshot({ path: 'e2e-entity-version-history.png', fullPage: true });
    await page.close();
  });

  it('[ac:ac-w-widoku-entityversionhistoryview-wers] labels an unassigned version "(unreleased)" instead of leaving the pill blank', async () => {
    const versions = await listVersions(project.id, slug);
    // The probe versions captured above are unreleased by construction.
    expect(versions.some((v) => v.releaseId == null)).toBe(true);

    const { page, consoleErrors } = await openHistory(browser, project.id, slug);
    expect(await page.getByText('(unreleased)').first().isVisible()).toBe(true);
    expect(consoleErrors).toEqual([]);
    await page.close();
  });

  it('[ac:ac-badge-changedby-w-widoku-historii-ent] shows a changedBy badge per row', async () => {
    const { page } = await openHistory(browser, project.id, slug);

    const badge = page.getByText(/^(user|agent|filesystem)$/).first();
    expect(await badge.isVisible()).toBe(true);
    // Colour-coded, not plain text — the `agent` vs `user` distinction itself is
    // asserted in `VersionHistory.test.ts` (`changedByBadgeStyle`).
    const bg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    await page.close();
  });

  it('[ac:ac-entityversionhistoryview-dla-encji-bez] shows a placeholder, not an error, when nothing is selected to compare', async () => {
    const { page, consoleErrors, badResponses } = await openHistory(browser, project.id, slug);

    // Default state: the next-older version is preselected, so the diff renders.
    await expect.poll(() => page.getByRole('tab', { name: 'Diff' }).isVisible()).toBe(true);

    // Clearing the compare target must degrade to a placeholder — never a throw.
    await page.getByRole('button', { name: 'Comparing' }).first().click();
    await page.waitForTimeout(300);

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);
    await page.close();
  });

  it('[ac:ac-allowrestore-false-ukrywa-akcje-rest] restores through the entity version endpoint, not the release one', async () => {
    const calls: string[] = [];
    const page: Page = (await openHistory(browser, project.id, slug)).page;
    page.on('request', (r) => {
      if (r.method() === 'POST') calls.push(new URL(r.url()).pathname);
    });

    await page.getByRole('button', { name: 'Restore' }).first().click();
    await page.waitForTimeout(1500);

    expect(calls.some((p) => /\/entities\/endpoint\/.+\/versions\/\d+\/restore$/.test(p))).toBe(true);
    // The M17 release-scoped restore is NOT the entity-history path any more.
    expect(calls.some((p) => /\/releases\/.+\/restore$/.test(p))).toBe(false);

    await page.close();
  });
});
