import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the sidebar OTHERS flyout stacks above the plan page's ActionBar.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * Structurally out of Vitest's reach, and out of `curl`'s too: the bug this
 * guards was a pure *stacking* one. The flyout was a hand-rolled Popover twin
 * pinned at `zIndex: 60`, while `ActionBar` sits at 900 — so the menu rendered
 * under the action bar and its lower items (Tags, Briefs, Links) swallowed
 * their clicks. Every request involved returned 200; only a real browser, and
 * specifically an ACTUAL CLICK rather than a visibility check, can tell the
 * difference. Hence the test navigates by clicking `Briefs`, not by asserting
 * the item is visible.
 *
 * The plan page is the venue because it is where the ActionBar renders.
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

/**
 * A plan whose body is non-empty — the ActionBar is gated on `plan.body.trim()`
 * (PlanPage), so a stub plan would give us a page with nothing to stack against
 * and the test would pass for the wrong reason.
 */
async function runnablePlanPath(projectId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/artifacts/plan`);
  const listed = (await res.json()) as { data: Array<{ path: string }> };
  for (const { path } of listed.data) {
    const detail = await fetch(
      `${BASE}/api/projects/${projectId}/artifacts/plan/${encodeURIComponent(path)}`,
    );
    if (!detail.ok) continue;
    const { data } = (await detail.json()) as { data: { body: string } };
    if (data.body.trim().length > 0) return path;
  }
  throw new Error(
    `no plan with a non-empty body in this environment (${listed.data.length} listed) — seed one first`,
  );
}

describe.skipIf(!BASE)('sidebar OTHERS flyout', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  let planPath: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    planPath = await runnablePlanPath(project.id);
  });
  afterAll(async () => {
    await browser?.close();
  });

  /** Opens the plan page and the flyout, collecting console/network failures. */
  async function openFlyout(page: Page) {
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });

    await page.goto(`${BASE}/p/${project.id}/plans/${encodeURIComponent(planPath)}`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'OTHERS' }).click();
    return { consoleErrors, badResponses };
  }

  it('renders above the ActionBar, so its lower items are clickable', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = await openFlyout(page);

    const panel = page.getByRole('dialog');
    await expect.poll(() => panel.isVisible()).toBe(true);

    // The primitive's tier (1100) beats the ActionBar's 900. A twin pinned at
    // 60 — the bug — fails right here.
    const z = await panel.evaluate((el) => getComputedStyle(el).zIndex);
    expect(z).toBe('1100');

    // The real proof: `Briefs` sits in the band the action bar occupies. If
    // anything paints over it, this click lands on the bar and the URL never
    // changes — Playwright fails the click as intercepted rather than silently
    // passing.
    await panel.getByRole('link', { name: 'Briefs' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toContain('/briefs');

    expect(consoleErrors).toEqual([]);
    expect(badResponses).toEqual([]);

    await page.close();
  });

  it('keeps the menu inside the viewport (the twin had no clamping)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 620 } });
    await openFlyout(page);

    const panel = page.getByRole('dialog');
    await expect.poll(() => panel.isVisible()).toBe(true);

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(620);

    await page.close();
  });

  it('marks the OTHERS trigger active on /briefs', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/p/${project.id}/briefs`, { waitUntil: 'networkidle' });

    const trigger = page.getByRole('button', { name: 'OTHERS' });
    const weight = await trigger.evaluate((el) => getComputedStyle(el).fontWeight);
    // `OTHERS_PATHS` drives this; before the fix `/briefs` was missing from it
    // even though Briefs is one of the menu's own items.
    expect(weight).toBe('600');

    await page.close();
  });
});
