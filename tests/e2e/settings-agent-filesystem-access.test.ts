import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: Settings → Agent, the "Block direct file access" control (0.2.53).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` stays safe to
 * run anywhere.
 *
 * Out of Vitest's reach on purpose, and each for a different reason:
 *
 *  - the checkbox DEFAULTS to checked on a project whose config.json has never
 *    carried the field. A route test proves the server answers `true`; only the
 *    rendered control proves the client did not default the other way while
 *    the first response was in flight.
 *  - checking it HIDES the path-scope fields rather than clearing them. That is
 *    a claim about two things at once — the DOM and the config — and the whole
 *    point is that the second one does not change when the first does.
 *  - the strength badge never says "hard" and always names the escape surface.
 *    That is a sentence a user reads; nothing below the UI can assert it.
 *  - the chat UI has NO control for this flag. An absence is only checkable
 *    where the chrome actually renders.
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

async function readConfig(projectId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/config`);
  return (await res.json()) as Record<string, unknown>;
}

const agentBranch = (cfg: Record<string, unknown>) => cfg.agent as Record<string, unknown>;

describe.skipIf(!BASE)('settings — Agent: block direct file access (0.2.53)', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await completeOnboarding(project.id);
    // Seed a path scope so "hidden, not cleared" has something to be about.
    await fetch(`${BASE}/api/projects/${project.id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: { allowedPaths: ['/tmp/e2e-scope-probe'] } }),
    });

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
    if (project) {
      await fetch(`${BASE}/api/projects/${project.id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: { disableDirectFilesystemAccess: true, allowedPaths: [] } }),
      }).catch(() => {});
    }
    await browser?.close();
  });

  const section = () => page.locator('#agent');
  const blockRow = () => section().locator('label', { hasText: 'Block direct file access' }).first();
  const blockCheckbox = () => blockRow().locator('input[type="checkbox"]').first();
  const allowedPathsField = () =>
    section().locator('label', { hasText: 'Allowed paths' }).locator('textarea').first();

  it('[ac:ac-checkbox-zablokuj-bezposredni-dostep] renders the checkbox checked by default', async () => {
    await expect.poll(() => blockCheckbox().count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => blockCheckbox().isChecked()).toBe(true);
  });

  /**
   * The badge is the one place the UI states how much the posture is worth.
   * Two things it must never do: claim hardness it does not have, and leave the
   * documented way around it unmentioned.
   */
  it('[ac:ac-badge-sily-przy-checkboxie-agent-disa] shows a soft-strength badge naming the native subagent as the escape', async () => {
    const badge = section().getByText(/strength: soft|Enforced softly/i).first();
    await expect.poll(() => badge.count()).toBeGreaterThan(0);
    /**
     * Scoped to the BADGE, not the section. The section legitimately uses the
     * word elsewhere — the note about the hard OS sandbox that still covers the
     * native subagent — and that sentence is the opposite of the thing this
     * criterion forbids: it is there precisely because this gate is not hard.
     */
    await expect.poll(async () => /\bhard\b/i.test((await badge.innerText()) ?? '')).toBe(false);
    await expect.poll(() => section().getByText(/Agent \/ Task/i).count()).toBeGreaterThan(0);
  });

  /** Hidden, not cleared — the config keeps the values while the control goes away. */
  it('hides the path-scope fields while checked, without clearing them', async () => {
    await expect.poll(() => allowedPathsField().count()).toBe(0);
    const cfg = await readConfig(project.id);
    expect(agentBranch(cfg).allowedPaths).toEqual(['/tmp/e2e-scope-probe']);
  });

  it('reveals the path-scope fields again when unchecked, with the values intact', async () => {
    await blockCheckbox().uncheck();
    await expect
      .poll(async () => agentBranch(await readConfig(project.id)).disableDirectFilesystemAccess, {
        timeout: 10_000,
      })
      .toBe(false);
    await expect.poll(() => allowedPathsField().count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => allowedPathsField().inputValue()).toContain('/tmp/e2e-scope-probe');
  });

  /**
   * Unlike Plan Mode, this flag has no per-turn surface: a policy fixed for a
   * whole thread has no business next to the box that starts one.
   */
  it('[ac:ac-ui-czatu-nie-ma-zadnej-kontrolki-agen] offers no control for the flag anywhere in the chat UI', async () => {
    await page.goto(`${BASE}/p/${project.id}`, { waitUntil: 'networkidle' });
    await expect.poll(() => page.getByText(/Block direct file access/i).count(), { timeout: 10_000 }).toBe(0);
  });

  /**
   * The highest-value assertion here: a 200 from the server says nothing about
   * whether the page rendered or what it logged on the way.
   */
  it('renders the whole flow with no console errors and no failed responses', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
