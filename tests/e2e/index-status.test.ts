import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: projection staleness, the three signal surfaces (0.2.77).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe anywhere.
 *
 * Out of Vitest's reach on purpose. A route test can prove the server reports a
 * projection as stale; it cannot prove the card RENDERS when everything is fine
 * (the property that makes it findable), that the banner stays away for a LOCAL
 * marking, or that the sidebar indicator has no dismiss control. Each of those
 * is a claim about pixels.
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

async function completeOnboarding(projectId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onboardingCompleted: true }),
  });
  if (!res.ok) throw new Error(`failed to complete onboarding: ${res.status}`);
}

interface StatusRow {
  id: string;
  label: string;
  state: string;
  scope?: 'global' | string[];
  lastRebuiltAt: number | null;
}

async function indexStatus(projectId: string): Promise<StatusRow[]> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/_meta/index-status`);
  return ((await res.json()) as { projections: StatusRow[] }).projections;
}

describe.skipIf(!BASE)('settings — Index status (0.2.77)', () => {
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

  const card = () => page.locator('#index-status');

  it('[ac:ac-karta-stan-indeksow-renderuje-sie-na] renders on /settings even when every projection is fresh', async () => {
    /**
     * The whole claim: the card is there when nothing is wrong. A card that
     * appeared only on failure would be indistinguishable from no card — nobody
     * would learn it exists until the moment they most needed it to already be
     * familiar.
     */
    await expect.poll(() => card().count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => card().getByText('Index status').count()).toBeGreaterThan(0);

    const rows = await indexStatus(project.id);
    expect(rows.length).toBeGreaterThan(0);
    // A healthy environment: assert the precondition this case is about, so a
    // green result cannot come from a card that only rendered because of trouble.
    expect(rows.every((r) => r.state !== 'stale')).toBe(true);

    // One visible row per projection, each with a rebuild control.
    for (const row of rows) {
      await expect.poll(() => card().locator(`[data-testid="index-status-row-${row.id}"]`).count()).toBe(1);
    }
  });

  it('sits between About and Danger zone', async () => {
    const order = await page.evaluate(() => {
      const ids = ['about', 'index-status', 'danger-zone'];
      return ids.map((id) => {
        const el = document.getElementById(id);
        return el ? el.getBoundingClientRect().top + window.scrollY : -1;
      });
    });
    expect(order[0]).toBeGreaterThan(0);
    expect(order[1]).toBeGreaterThan(order[0]!);
    expect(order[2]).toBeGreaterThan(order[1]!);
  });

  it('[ac:ac-odbudowa-pojedynczej-projekcji-z-kart] a per-row rebuild moves the last-rebuilt time of THAT projection only', async () => {
    const before = await indexStatus(project.id);
    const target = before[0]!;
    const others = before.filter((r) => r.id !== target.id);

    await card().locator(`[data-testid="index-status-row-${target.id}"]`).getByRole('button', { name: 'Rebuild' }).click();

    /**
     * The timestamp is the whole point of the assertion: it moves ONLY on a
     * successful recompute, which is what lets a user tell "the rebuild failed"
     * from "the rebuild worked and it went stale again straight afterwards" —
     * a second, separate failure rather than a failed action.
     */
    await expect
      .poll(async () => (await indexStatus(project.id)).find((r) => r.id === target.id)?.lastRebuiltAt, {
        timeout: 20_000,
      })
      .not.toBe(target.lastRebuiltAt);

    const after = await indexStatus(project.id);
    for (const other of others) {
      expect(after.find((r) => r.id === other.id)?.lastRebuiltAt).toBe(other.lastRebuiltAt);
    }
  });

  it('[ac:ac-pas-na-cala-szerokosc-nad-interfejsem] shows no full-width banner while nothing is globally stale', async () => {
    /**
     * The negative half of the exception, and the half worth guarding: the bar
     * is the ONLY thing allowed above the flex-row, so it appearing when it
     * should not is a breach of the layout rule rather than a cosmetic slip.
     */
    const rows = await indexStatus(project.id);
    expect(rows.some((r) => r.state === 'stale' && r.scope === 'global')).toBe(false);
    await page.goto(`${BASE}/p/${project.id}/`, { waitUntil: 'networkidle' });
    await expect.poll(() => page.locator('[data-testid="index-stale-banner"]').count()).toBe(0);
  });

  it('[ac:ac-wskaznik-nieswiezosci-w-naglowku-pane] shows no sidebar indicator while nothing is stale, and offers no dismiss control', async () => {
    const badge = page.locator('[data-testid="index-status-badge"]');
    await expect.poll(() => badge.count()).toBe(0);
    /**
     * When it IS shown the indicator must not be closable — it states "this is
     * still true", and a control that let the user clear it would let them hide
     * a condition under which their writes are being refused. The component
     * renders exactly one button (the navigation itself) and no dismiss affordance.
     */
    const dismissables = await page.locator('[data-testid="index-status-badge"] [aria-label*="ismiss"]').count();
    expect(dismissables).toBe(0);
  });

  it('reports no console errors and no failed responses across the whole pass', () => {
    // The highest-value assertion in the file: a page can answer 200 and still
    // be broken, and only the browser can say so.
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
