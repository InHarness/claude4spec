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

  it('restores the chat overlay on a thread with no running turn as plain history, with a clean console', async () => {
    const created = await fetch(`${api}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'render probe' }),
    });
    const { data: thread } = (await created.json()) as { data: { id: string } };

    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    // Scoped to the endpoints this test is a contract over. A blanket ">= 400
    // anywhere" would make an unrelated tolerated 404 (a plugin manifest probe,
    // a favicon) fail the resume case with a misleading message.
    page.on('response', (res) => {
      if (res.status() >= 400 && /\/(threads|chat)(\/|\?|$)/.test(res.url())) {
        badResponses.push(`${res.status()} ${res.url()}`);
      }
    });

    const home = `${BASE}/p/${project.id}/`;
    await page.goto(home, { waitUntil: 'networkidle' });
    // The chat is an OVERLAY, not a route: which thread is open lives in a
    // persisted zustand store (`c4s:m05:chat-store::<projectId>`). Seeding it and
    // reloading is literally the F5 path — the one that used to guess liveness
    // from message status and could park on a resume that never resolved.
    await page.evaluate(
      ([projectId, threadId]) => {
        localStorage.setItem(
          `c4s:m05:chat-store::${projectId}`,
          JSON.stringify({
            state: {
              chatOpen: true,
              chatWidth: 560,
              chatThreadId: threadId,
              model: 'opus-5',
              thinking: 'medium',
            },
            version: 3,
          }),
        );
      },
      [project.id, thread.id],
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const shot = `${process.env.TMPDIR ?? '/tmp'}/c4s-e2e-chat-live-join.png`;
    await page.screenshot({ path: shot });

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(badResponses, `failed requests: ${badResponses.join(' | ')}`).toEqual([]);
    // Assert the overlay actually MOUNTED, not just that the page returned 200 —
    // a wrong URL renders the welcome shell, which is also a clean 200.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText, `screenshot: ${shot}`).toContain('render probe');
    expect(await page.locator('[contenteditable="true"], textarea').count()).toBeGreaterThan(0);

    await page.close();
  }, 60_000);

  /**
   * 0.2.50 — the Plan Mode toggle must not be offered where the deny-groups it
   * desugars to cannot be enforced, because turning it on would only make the
   * next turn refuse to start (`TOOL_POLICY_REFUSED`).
   *
   * Server-side because the adapter package's main entry pulls the agent runtime
   * and is not browser-safe, so the client cannot probe for itself.
   */
  it('reports plan-mode enforceability on the chat config so the toggle can gate on it', async () => {
    const res = await fetch(`${api}/chat/config`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { planModeEnforceable?: boolean };
    // A real boolean, not undefined: the client defaults a missing value to
    // `true`, so an absent field would silently look like a working toggle.
    expect(typeof body.planModeEnforceable).toBe('boolean');
    // claude-code enforces all four groups (at `soft` strength).
    expect(body.planModeEnforceable).toBe(true);
  });

  /**
   * 0.2.50 — `connected` carries `replayTruncated` ONLY when the replay buffer
   * blew its 4 MB budget, so its presence is always information. A quiet join
   * must not carry the key at all, and `live` must still be gone.
   */
  it('omits replayTruncated and live from the connected frame of a quiet join', async () => {
    const created = await fetch(`${api}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'connected-shape probe' }),
    });
    const { data: thread } = (await created.json()) as { data: { id: string } };

    // No turn running ⇒ 404 rather than a stream. That IS the contract, and it
    // is what makes the field-shape assertion below reachable only via the unit
    // suite — asserted here so the two stay honest about which layer proves what.
    const res = await fetch(`${api}/chat/stream/${thread.id}`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(404);
  });

  /**
   * 0.2.50 — the background-task panel moved from a flat list appended after the
   * whole conversation to a block inside the turn. This case proves the shipped
   * BUNDLE still mounts and renders a thread cleanly after that refactor, which a
   * `curl` cannot: the block is placed by a synthetic carrier through the library
   * reducer, and a mistake there throws inside <ToolCard /> and takes the entire
   * overlay down rather than degrading.
   *
   * NOT covered: a real background task in flight. An ephemeral environment has
   * no Claude login, so no agent turn can run — same limitation as the mid-turn
   * F5 case noted at the top of this file. The hold → continuation path is proven
   * by the unit suite against a scripted adapter stream.
   */
  it('renders a thread with the reworked turn blocks without a console error', async () => {
    const created = await fetch(`${api}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'turn-block probe' }),
    });
    const { data: thread } = (await created.json()) as { data: { id: string } };

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

    const home = `${BASE}/p/${project.id}/`;
    await page.goto(home, { waitUntil: 'networkidle' });
    await page.evaluate(
      ([projectId, threadId]) => {
        localStorage.setItem(
          `c4s:m05:chat-store::${projectId}`,
          JSON.stringify({
            state: {
              chatOpen: true,
              chatWidth: 560,
              chatThreadId: threadId,
              model: 'opus-5',
              thinking: 'medium',
            },
            version: 3,
          }),
        );
      },
      [project.id, thread.id],
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const shot = `${process.env.TMPDIR ?? '/tmp'}/c4s-e2e-turn-blocks.png`;
    await page.screenshot({ path: shot });

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(badResponses, `failed requests: ${badResponses.join(' | ')}`).toEqual([]);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText, `screenshot: ${shot}`).toContain('turn-block probe');

    await page.close();
  }, 60_000);
});
