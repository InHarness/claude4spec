import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: workspace root/welcome routing + the Danger-zone removal flow.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * These cases exist because the behavior they cover is structurally out of
 * Vitest's reach: an HTTP redirect chain a browser actually follows, React
 * state gating a confirm button, and errors that only surface in a page's
 * console. `curl` reported 200/302 happily while the page logged two 404s.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

async function listProjects(): Promise<WorkspaceProject[]> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  return body.projects;
}

/** Guarantee at least one registered project and return the first one. */
async function ensureProject(previous?: WorkspaceProject): Promise<WorkspaceProject> {
  const existing = await listProjects();
  if (existing.length > 0) return existing[0]!;
  if (!previous) throw new Error('no project registered and no cwd to restore one from');
  // Re-registering the same cwd restores the detached project (data kept on disk).
  await fetch(`${BASE}/api/workspace/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: previous.cwd }),
  });
  const restored = await listProjects();
  if (restored.length === 0) throw new Error(`failed to restore project at ${previous.cwd}`);
  return restored[0]!;
}

/** Poll an async predicate — Vitest's `expect` does not auto-retry like Playwright's. */
async function until(predicate: () => Promise<boolean>, message: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${message}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const pathOf = (page: Page) => new URL(page.url()).pathname;

describe.skipIf(!BASE)('workspace root & welcome routing', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  /**
   * NOTE: this AC's text in the spec still ends with „nawigacja na / → strona
   * »no projects«" — the pre-0.1.137 wording. Release 0.1.136→0.1.137 replaced
   * that page with `/welcome` as the unconditional root target, so the case
   * below asserts the BRIEF's behavior (the authority for this release) and the
   * stale AC text is reported back to the spec author as a drift patch. The
   * test is not bent to the code, and the code is not bent to a stale AC.
   */
  it('[ac:ac-po-udanym-usunieciu-projektu-detach-lub] detaching the last project lands the UI on /welcome', async () => {
    const project = await ensureProject();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    // Precondition: with a project registered, the root must ALREADY refuse to
    // auto-jump into it (0.1.137) — otherwise the assertion below proves nothing.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    expect(pathOf(page)).toBe('/welcome');

    await page.goto(`${BASE}/p/${project.id}/settings`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Detach project', exact: true }).click();
    // Detach has no type-to-confirm — the modal's confirm is live immediately.
    await page.getByRole('button', { name: 'Detach', exact: true }).click();

    await until(async () => pathOf(page) === '/welcome', 'UI to land on /welcome after detach');
    expect(pathOf(page)).toBe('/welcome');
    expect(await listProjects()).toHaveLength(0);

    await page.close();
    await ensureProject(project); // restore — keeps the suite re-runnable
  });

  it('[ac:ac-akcja-purge-usun-projekt-i-dane-c4s] purge stays disabled until the exact project name is typed', async () => {
    const project = await ensureProject();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${BASE}/p/${project.id}/settings`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Delete project & c4s data', exact: true }).click();

    // The modal's type-to-confirm input is keyed by the project name placeholder.
    // `exact` matters: the default substring match also hits Settings inputs
    // placeheld "relative to project root".
    const input = page.getByPlaceholder(project.name, { exact: true });
    await input.waitFor({ state: 'visible' });
    const confirm = page.getByRole('button', { name: 'Delete data', exact: true });

    expect(await confirm.isDisabled()).toBe(true);

    await input.fill(`${project.name}-not-quite`);
    await until(async () => confirm.isDisabled(), 'confirm to stay disabled for a wrong name');

    await input.fill(project.name);
    await until(async () => confirm.isEnabled(), 'confirm to enable on the exact name');

    // The warning must state what is destroyed and what is left alone.
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/cannot be recovered/i);
    expect(body).toMatch(/Nothing in the project directory is touched/i);

    // Deliberately NOT clicking confirm — this case verifies the gate, and
    // purging would destroy the environment's project data.
    await page.keyboard.press('Escape');
    await page.close();
  });

  it('serves /welcome with no failed requests and no console errors', async () => {
    await ensureProject();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const failed: string[] = [];
    const consoleErrors: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    // Root chains into /welcome — exercise the real entry point, not /welcome directly.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    expect(pathOf(page)).toBe('/welcome');
    await page.getByRole('heading', { name: /Welcome to claude4spec/i }).waitFor();

    // `/welcome` runs project-less (PROJECT_ID=''), so nothing may fire a
    // project-scoped `/api/...` call from there — those resolve without the
    // `/api/projects/<id>` prefix and 404. Regression guard for that class.
    expect(failed).toEqual([]);
    expect(consoleErrors).toEqual([]);

    await page.close();
  });
});
