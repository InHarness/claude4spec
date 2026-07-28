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
 * The venue is `/acs`, not the plan page the brief describes. Both render an
 * `ActionBar` and the stacking question is identical, but the AC list renders
 * its bar UNCONDITIONALLY while `PlanPage` gates its own on a non-empty plan
 * body — so on the plan page this test would silently pass against a page with
 * nothing to stack against whenever the environment has no seeded plan. (The
 * `demo-c4s` seed has exactly that gap today: zero plans, which is also why
 * `plan-footer.test.ts` fails there.)
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

describe.skipIf(!BASE)('sidebar OTHERS flyout', () => {
  let browser: Browser;
  let project: WorkspaceProject;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
  });
  afterAll(async () => {
    await browser?.close();
  });

  /** Opens the AC list page and the flyout, collecting console/network failures. */
  async function openFlyout(page: Page) {
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });

    await page.goto(`${BASE}/p/${project.id}/acs`, { waitUntil: 'networkidle' });
    // The bar this must stack above.
    await expect
      .poll(() => page.getByRole('button', { name: 'Analyze consistency' }).count())
      .toBe(1);
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

    // `Links` is the LAST menu item and the one genuinely buried in the action
    // bar's band. `Briefs` is not a substitute: measured at 1440x900 its rect
    // only clips the bar by ~7px at the bottom, so its CENTRE — the point
    // Playwright clicks — stays clear of the bar and would pass even on the
    // broken build.
    const item = panel.getByRole('link', { name: 'Links' });
    const itemBox = await item.boundingBox();
    const barBox = await page.evaluate(() => {
      for (const el of document.querySelectorAll('div')) {
        const s = getComputedStyle(el);
        if (s.position === 'sticky' && s.zIndex === '900') {
          const r = el.getBoundingClientRect();
          return { y: r.y, height: r.height };
        }
      }
      return null;
    });

    // Assert the test's own premise. If a layout change ever lifts the menu
    // clear of the bar, the click below stops proving anything — and a test
    // that silently goes vacuous is worse than one that fails.
    expect(itemBox, 'Links item must be laid out').not.toBeNull();
    expect(barBox, 'the AC list page must render an ActionBar').not.toBeNull();
    const centre = itemBox!.y + itemBox!.height / 2;
    expect(
      centre,
      "Links' centre must fall inside the ActionBar band, or this test is vacuous",
    ).toBeGreaterThan(barBox!.y);

    // The real proof: on the broken build the bar paints over this point and
    // Playwright fails the click as intercepted.
    await item.click();
    await expect.poll(() => new URL(page.url()).pathname).toContain('/links');

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
