import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the M33 project-local plugin trust gate (0.2.1 — brief 0-1-144-to-0-2-1).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * Structurally out of Vitest's reach: the property under test is that the gate
 * CANNOT be dismissed — pressing Escape and clicking the scrim must leave it
 * standing. That is a real keyboard/pointer interaction against a mounted
 * React tree, and it is a security property: the gate exists so that foreign
 * code committed to a repo is never loaded by a reflexive click beside the
 * panel. In 0.2.1 the gate stopped hand-rolling its own scrim and became a
 * facade over the catalog `Dialog` with `dismissible={false}`; the regression
 * this guards is that migration quietly restoring a close path.
 *
 * The environment need not actually ship `.claude4spec/plugins/`: the gate is
 * driven entirely by `GET /api/projects/:id/_meta/plugins`, so the response is
 * stubbed to the "local plugins present, no decision recorded" state. The
 * decision endpoint is stubbed too, so a run never mutates the environment.
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

const UNDECIDED_META = {
  hostApiVersion: '1.0.0',
  localPluginsPresent: true,
  trust: undefined,
  packages: [
    {
      package: 'c4s-plugin-example',
      status: 'loaded',
      layer: 'overlay',
      trust: 'untrusted',
      origin: '.claude4spec/plugins/c4s-plugin-example',
      contributedTypes: ['example-entity'],
    },
  ],
  shadowed: [],
};

/** Opens the app with the plugins-meta response pinned to the undecided state. */
async function openWithUndecidedGate(browser: Browser, projectId: string) {
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
  });

  await page.route(`**/api/projects/${projectId}/_meta/plugins`, (route) =>
    // `trust: undefined` cannot survive JSON.stringify, so the key is simply absent —
    // which is exactly what the server sends for "no decision recorded".
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(UNDECIDED_META) }),
  );
  // Never let a click actually record a trust decision in the environment.
  await page.route(`**/api/projects/${projectId}/trust-plugins`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trust: false }) }),
  );

  await page.goto(`${BASE}/p/${projectId}/`, { waitUntil: 'domcontentloaded' });
  return { page, consoleErrors, badResponses };
}

function gate(page: Page) {
  return page.getByRole('dialog').filter({ hasText: "Trust this project's plugins?" });
}

describe.skipIf(!BASE)('M33 plugin trust gate — undismissable Dialog', () => {
  let browser: Browser;
  let project: WorkspaceProject;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('blocks the shell and survives Escape and a scrim click', async () => {
    const { page, consoleErrors, badResponses } = await openWithUndecidedGate(browser, project.id);
    try {
      const dialog = gate(page);
      await expect.poll(() => dialog.isVisible(), { timeout: 15_000 }).toBe(true);

      // Escape: wired for a dismissible dialog, deliberately inert here.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      expect(await dialog.isVisible()).toBe(true);

      // Scrim: click the very corner of the viewport, outside the panel.
      await page.mouse.click(4, 4);
      await page.waitForTimeout(300);
      expect(await dialog.isVisible()).toBe(true);

      // …and the gate must still hold the KEYBOARD. Asserting only that it is
      // still visible after the scrim click misses the real bypass: the click
      // used to blur into <body>, from where Tab walked into the shell behind
      // the scrim while the trust decision was unresolved.
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      const focusInsideGate = await page.evaluate(() => {
        const active = document.activeElement;
        const panel = document.querySelector('[role="dialog"]');
        return !!(active && panel && panel.contains(active));
      });
      expect(focusInsideGate, 'Tab must not move focus out of the gate').toBe(true);

      // No "close only" affordance inside the panel either — the header ✕ is
      // suppressed when `dismissible` is false, so the two decisions are the
      // only way out.
      await expect.poll(() => dialog.getByRole('button', { name: 'Close' }).count()).toBe(0);
      await expect.poll(() => dialog.getByRole('button', { name: /Trust & load/ }).count()).toBe(1);
      await expect.poll(() => dialog.getByRole('button', { name: /Don't trust/ }).count()).toBe(1);

      expect(consoleErrors, 'console errors while the gate is up').toEqual([]);
      expect(badResponses, 'responses >= 400 while the gate is up').toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('lists the overlay packages awaiting a decision', async () => {
    const { page } = await openWithUndecidedGate(browser, project.id);
    try {
      const dialog = gate(page);
      await expect.poll(() => dialog.isVisible(), { timeout: 15_000 }).toBe(true);
      // Exact match: the origin path below *contains* the package name, so a
      // substring match legitimately finds both rows.
      await expect.poll(() => dialog.getByText('c4s-plugin-example', { exact: true }).count()).toBe(1);
      await expect
        .poll(() =>
          dialog.getByText('.claude4spec/plugins/c4s-plugin-example', { exact: true }).count(),
        )
        .toBe(1);
    } finally {
      await page.close();
    }
  });

  it('does not appear once a decision is recorded', async () => {
    // The same page WITHOUT the stub: the environment has a real decision (or no
    // local plugins), so nothing should block the shell — this is the guard
    // against the gate leaking into every ordinary session.
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE}/p/${project.id}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_500);
      expect(await gate(page).count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
