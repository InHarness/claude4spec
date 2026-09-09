import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: moving a page is one operation, and the sidebar can trigger it.
 *
 * Out of Vitest's reach on purpose, on both halves.
 *
 * The SERVER half is reachable in supertest and is asserted there; what is not
 * is that the route survives real mounting. `POST /api/pages/:rootId/move` sits
 * in a router whose other write verbs are splat routes, so the one way it can
 * fail in production and nowhere else is registration order — `move` read as a
 * page path. That is a 404 against a route the unit rig proves works.
 *
 * The CLIENT half is the reason this file exists at all. A rename from the tree
 * is three things in sequence — read the page for its hash, POST the move,
 * re-point the caches — and every one of them can fail while the request looks
 * perfect from the server's side. A `curl` of the endpoint proves none of it.
 *
 * The console-error and failed-response assertions are the cheap half and have
 * historically caught more than the explicit ones: a page that renders can still
 * be firing 404s behind the shell.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

const FROM = 'e2e-move-source.md';
const TO = 'e2e-move-target.md';
const CITER = 'e2e-move-citer.md';
const MARKER = 'MOVE MARKER';

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

describe.skipIf(!BASE)('move_page — a rename is one operation', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  const pagesUrl = (rel: string) => `${BASE}/api/projects/${project.id}/pages/pages/${rel}`;
  const moveUrl = () => `${BASE}/api/projects/${project.id}/pages/pages/move`;

  const put = (rel: string, body: string) =>
    fetch(pagesUrl(rel), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // The file does not exist yet, so any value passes the guard: there is
      // nothing for it to be stale against.
      body: JSON.stringify({ body, expectedHash: 'a'.repeat(64) }),
    });

  const hashOf = async (rel: string) =>
    ((await (await fetch(pagesUrl(rel))).json()) as { hash: string }).hash;

  const move = (from: string, to: string, expectedHash: string) =>
    fetch(moveUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, expectedHash }),
    });

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await fetch(`${BASE}/api/projects/${project.id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    await put(FROM, `# Move source\n\n${MARKER}\n`);
    await put(CITER, `# Citer\n\ncites @${FROM}\n`);

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`);
    });
  });

  afterAll(async () => {
    for (const rel of [FROM, TO, CITER]) {
      await fetch(pagesUrl(rel), { method: 'DELETE' }).catch(() => {});
    }
    await browser?.close();
  });

  it('reaches the verb rather than a page called `move`, and relocates the file', async () => {
    const before = await hashOf(FROM);
    const res = await move(FROM, TO, before);
    expect(res.status).toBe(200);
    const ack = (await res.json()) as { path: string; hash: string; rootId: string };
    expect(ack.path).toBe(TO);
    // The hash is unchanged BY CONTRACT: the bytes are relocated by rename and
    // the format adapter never runs, so a changed hash would mean the content
    // had been round-tripped through the serializer on the way.
    expect(ack.hash).toBe(before);

    expect((await fetch(pagesUrl(TO))).status).toBe(200);
    expect((await fetch(pagesUrl(FROM))).status).toBe(404);
  });

  it('rewrites the citation in the OTHER page — the propagation is wired, not just implemented', async () => {
    /**
     * `renameSync` shipped in 0.2.77 with nothing calling it. A move that leaves
     * `@old.md` behind in every citing page looks entirely successful from the
     * endpoint's answer, which is why this is asserted from the outside.
     */
    const citer = (await (await fetch(pagesUrl(CITER))).json()) as { content?: string; body?: string };
    const text = citer.content ?? citer.body ?? '';
    expect(text).toContain(`@${TO}`);
    expect(text).not.toContain(`@${FROM}`);
  });

  it('answers a replay with 404 NOT_FOUND, not a bad-argument 400', async () => {
    const res = await move(FROM, TO, 'a'.repeat(64));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('the tree renders the page at its new path after the move', async () => {
    await page.goto(`${BASE}/p/${project.id}/pages/${TO}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    // Asserting on RENDERED CONTENT, not on the URL: a white SPA shell also
    // answers 200 at any address.
    expect(await page.content()).toContain(MARKER);
  });

  it('renders the page with no console errors and no failed responses', () => {
    // The cheap half, and the one that catches a page that looks fine while
    // firing 404s behind the shell.
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
