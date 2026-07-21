import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the M10 plan footer (0.1.138 — running a plan became a pure chat workflow).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * Structurally out of Vitest's reach: the draft only exists in a TipTap editor
 * inside `<ChatOverlay />`, and the failure mode this guards is a TIMING one —
 * `requestChatPrefill` fills the composer ~50ms after the click while the
 * draft-restore effect (fired by the same action's `setChatThreadId` switch)
 * clears it ~50ms later. Both requests return 200/201 either way; only a real
 * browser can tell whether the prompt survived.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

const RUN_DRAFT = 'Execute the attached plan';
const ANALYSE_DRAFT = 'Analyse the plan 3 times';

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

/** A plan with a body — the footer only renders when `plan.body` is non-empty. */
async function firstPlanPath(projectId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/artifacts/plan`);
  const body = (await res.json()) as { data: Array<{ path: string }> };
  const path = body.data[0]?.path;
  if (!path) throw new Error('no plan in this environment — seed one first');
  return path;
}

describe.skipIf(!BASE)('plan footer — Run plan / Analyse plan', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  let planPath: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    planPath = await firstPlanPath(project.id);
  });
  afterAll(async () => {
    await browser?.close();
  });

  /**
   * Opens the plan page, clicks `label`, and returns what the composer holds
   * once everything has settled — plus the traffic the click produced.
   */
  async function clickFooterButton(page: Page, label: string) {
    const createThreadCalls: number[] = [];
    const chatPosts: string[] = [];
    page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.endsWith('/create-thread')) createThreadCalls.push(r.status());
      if (path.endsWith('/chat') && r.request().method() === 'POST') chatPosts.push(path);
    });

    await page.goto(`${BASE}/p/${project.id}/plans/${encodeURIComponent(planPath)}`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: label, exact: true }).click();

    // Outlast BOTH 50ms timers (prefill + draft-restore) before reading, so a
    // composer that gets cleared out from under the prefill fails the assert.
    await page.waitForTimeout(1500);
    const composer = (await page.locator('.chat-input-pm').first().innerText()).trim();
    return { composer, createThreadCalls, chatPosts };
  }

  it('[ac:ac-plans-run-analyse-plan-create-thread-draft] Run plan opens a new thread and drafts the prompt without sending it', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const { composer, createThreadCalls, chatPosts } = await clickFooterButton(page, 'Run plan');

    expect(createThreadCalls).toEqual([201]);
    expect(composer).toContain(RUN_DRAFT);
    // The draft is a DRAFT: the user sends it, not the app.
    expect(chatPosts).toEqual([]);

    await page.close();
  });

  it('[ac:ac-plans-run-analyse-differ-only-draft] Analyse plan takes the same path and differs only in the draft', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const { composer, createThreadCalls, chatPosts } = await clickFooterButton(page, 'Analyse plan');

    expect(createThreadCalls).toEqual([201]);
    expect(composer).toContain(ANALYSE_DRAFT);
    expect(composer).not.toContain(RUN_DRAFT);
    expect(chatPosts).toEqual([]);

    await page.close();
  });

  it('[ac:ac-route-plans-planid-ma-edytowalny-tip] the footer offers Run plan / Analyse plan and no per-thread execution mode', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/p/${project.id}/plans/${encodeURIComponent(planPath)}`, {
      waitUntil: 'networkidle',
    });

    await expect
      .poll(() => page.getByRole('button', { name: 'Run plan', exact: true }).isVisible())
      .toBe(true);
    expect(await page.getByRole('button', { name: 'Analyse plan', exact: true }).isVisible()).toBe(true);
    // 0.1.138 removed "run in the CURRENT thread" — every run starts a new one.
    expect(await page.getByRole('button', { name: /Run in (new )?thread/ }).count()).toBe(0);

    await page.close();
  });

  it('[ac:ac-post-api-plans-planid-create-thread] create-thread returns 201 { threadId } and the removed execute endpoint 404s', async () => {
    const created = await fetch(
      `${BASE}/api/projects/${project.id}/plans/${encodeURIComponent(planPath)}/create-thread`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { threadId: string } };
    expect(body.data.threadId).toEqual(expect.any(String));

    const gone = await fetch(
      `${BASE}/api/projects/${project.id}/plans/${encodeURIComponent(planPath)}/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'new-session' }),
      },
    );
    expect(gone.status).toBe(404);
  });
});
