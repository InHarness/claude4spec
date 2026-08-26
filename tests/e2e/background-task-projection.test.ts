import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the DETAIL-ONLY task projection (0.2.52 — brief 0-2-51-to-0-2-52).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe anywhere.
 *
 * `subagentTasks` / `backgroundTasks` ride the detail handler and are absent
 * from the thread list, which the unit suite pins against a real DB. What only a
 * live app can prove is the half a supertest run cannot reach: that the SHIPPED
 * bundle reads the collections off the payload without throwing. They used to be
 * OPTIONAL in the client's inline response type and were consumed through `??
 * []`, so a projection that quietly stopped sending them would have rendered a
 * clean, empty, wrong panel rather than failing. The console-error and
 * HTTP-status assertions are the point of the browser case, not a garnish.
 *
 * NOT covered here: a task actually being backgrounded. That needs a live agent
 * turn, and an ephemeral environment has no Claude login — the row lifecycle is
 * covered instead by `src/server/services/chat.background-task.test.ts`.
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

async function newThread(api: string, title: string): Promise<string> {
  const created = await fetch(`${api}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  expect(created.status).toBe(201);
  const { data } = (await created.json()) as { data: { id: string } };
  return data.id;
}

describe.skipIf(!BASE)('background-task detail projection', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  let api: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    api = `${BASE}/api/projects/${project.id}`;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('serves backgroundTasks on the thread detail and withholds it from the list', async () => {
    const threadId = await newThread(api, 'background-projection probe');

    const detail = (await (await fetch(`${api}/threads/${threadId}`)).json()) as {
      data: Record<string, unknown>;
    };
    // Present and empty, never absent: the client relies on the collection
    // always being there, so an omission is a contract break, not a tidy default.
    expect(Array.isArray(detail.data.backgroundTasks)).toBe(true);
    expect(detail.data.backgroundTasks).toEqual([]);
    expect(Array.isArray(detail.data.subagentTasks)).toBe(true);
    expect(Array.isArray(detail.data.queuedMessages)).toBe(true);

    const list = (await (await fetch(`${api}/threads`)).json()) as {
      data: Array<Record<string, unknown>>;
    };
    const row = list.data.find((t) => t.id === threadId);
    expect(row).toBeDefined();
    // Absent, not empty. The list must not touch the task tables at all — one
    // extra query per listed row, for no reader.
    expect(row).not.toHaveProperty('backgroundTasks');
    expect(row).not.toHaveProperty('subagentTasks');
    // Contrast: `isLive` DOES ride the list, because `hydrateThread()` computes
    // it. That is the line this projection sits on the other side of.
    expect(row).toHaveProperty('isLive');
  });

  it('opens a thread whose detail carries the collections with a clean console', async () => {
    const threadId = await newThread(api, 'background-render probe');

    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && /\/(threads|chat)(\/|\?|$)/.test(res.url())) {
        badResponses.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto(`${BASE}/p/${project.id}/`, { waitUntil: 'networkidle' });
    // The chat is an OVERLAY, not a route: which thread is open lives in a
    // persisted zustand store. Seeding it and reloading IS the F5 path — the one
    // that rebuilds the background-task panel from the persisted rows.
    await page.evaluate(
      ([projectId, tid]) => {
        localStorage.setItem(
          `c4s:m05:chat-store::${projectId}`,
          JSON.stringify({
            state: {
              chatOpen: true,
              chatWidth: 560,
              chatThreadId: tid,
              model: 'opus-5',
              thinking: 'medium',
            },
            version: 3,
          }),
        );
      },
      [project.id, threadId],
    );
    await page.reload({ waitUntil: 'networkidle' });
    // Wait for the overlay to actually hydrate rather than sleeping a fixed
    // 1.5s — on a slow container the sleep expires before the mount and the
    // assertions below fail for a reason that has nothing to do with them.
    await page.waitForFunction(
      (title) => document.body.innerText.includes(title),
      'background-render probe',
      { timeout: 20_000 },
    );

    const shot = `${process.env.TMPDIR ?? '/tmp'}/c4s-e2e-background-task-projection.png`;
    await page.screenshot({ path: shot });

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(badResponses, `failed requests: ${badResponses.join(' | ')}`).toEqual([]);
    // Assert the overlay actually MOUNTED — a wrong URL renders the welcome
    // shell, which is also a clean 200.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText, `screenshot: ${shot}`).toContain('background-render probe');
    // No task was backgrounded, so the panel must not appear at all. This is the
    // assertion that would catch a reconstruction that renders a stray block for
    // an empty collection. Case-INSENSITIVE deliberately: the panel header sits
    // under Tailwind's `uppercase`, and `innerText` applies text-transform, so it
    // reaches us as `BACKGROUND · SHELL` — a literal match here never fails.
    expect(bodyText.toLowerCase()).not.toContain('background \u00b7');

    await page.close();
  }, 60_000);
});
