import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the turn-resume contract (0.2.47 — brief 0-2-46-to-0-2-47).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe anywhere.
 *
 * What lives here rather than in Vitest: `isLive` and the live-join 404 are a
 * TWO-SIDED contract, and the client half only exists once the chat UI has
 * actually mounted. A supertest run proves the server answers; it cannot prove
 * that the shipped bundle reads `isLive` off the payload without throwing, or
 * that a thread whose turn is over opens as plain history instead of parking on
 * a spinner. The console-error and HTTP-status assertions are the point of the
 * file, not a garnish.
 *
 * NOT covered here: a genuine mid-turn F5. That needs a live agent turn in
 * flight, and an ephemeral environment has no Claude login — see
 * `ac-po-f5-ui-pokazuje-pelna-tresc-trwajac` in `tests/ac-skiplist.json`.
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

describe.skipIf(!BASE)('chat turn-resume contract', () => {
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

  it('[ac:ac-islive-odzwierciedla-zywa-ture-i-giei] serves isLive on both the thread detail and the thread list', async () => {
    const created = await fetch(`${api}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'resume-contract probe' }),
    });
    expect(created.status).toBe(201);
    const { data: thread } = (await created.json()) as { data: { id: string } };

    const detail = await (await fetch(`${api}/threads/${thread.id}`)).json();
    // Nothing is streaming, and nothing streams after a restart either — the
    // field must be present and false, not absent.
    expect(detail.data).toHaveProperty('isLive', false);

    const list = await (await fetch(`${api}/threads`)).json();
    const row = (list.data as Array<{ id: string; isLive?: boolean }>).find(
      (t) => t.id === thread.id,
    );
    expect(row).toBeDefined();
    // `ChatThreadMeta extends ChatThread`, so the list projection carries it too.
    expect(row).toHaveProperty('isLive', false);
  });

  it('[ac:ac-dolaczenie-do-martwej-tury-404-bez-ot] live-join on a thread with no running turn 404s instead of opening a stream', async () => {
    const created = await fetch(`${api}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'dead-turn probe' }),
    });
    const { data: thread } = (await created.json()) as { data: { id: string } };

    const res = await fetch(`${api}/chat/stream/${thread.id}`, {
      headers: { Accept: 'text/event-stream' },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toContain('text/event-stream');
    // The pre-0.2.47 endpoint opened the stream and emitted `done`; a joiner that
    // still waits for `done` here would hang forever.
    expect(await res.text()).not.toContain('event: done');
  });

  it('opens a thread with no running turn as plain history, with a clean console', async () => {
    const created = await fetch(`${api}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'render probe' }),
    });
    const { data: thread } = (await created.json()) as { data: { id: string } };

    const page: Page = await browser.newPage();
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(`${BASE}/projects/${project.id}/chat/${thread.id}`, {
      waitUntil: 'networkidle',
    });
    // Reload once: this is the path that used to guess liveness from message
    // status and could park the view on a resume that never resolves.
    await page.reload({ waitUntil: 'networkidle' });

    const shot = `${process.env.TMPDIR ?? '/tmp'}/c4s-e2e-chat-live-join.png`;
    await page.screenshot({ path: shot, fullPage: true });

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(badResponses, `failed requests: ${badResponses.join(' | ')}`).toEqual([]);
    // A white SPA shell also returns 200 — assert something rendered.
    expect(await page.locator('body').innerText()).not.toBe('');

    await page.close();
  }, 60_000);
});
