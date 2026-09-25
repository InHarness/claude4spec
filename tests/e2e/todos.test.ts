import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the TODO list (`/todos`) — grouping per (root, file) and the jump to a marker.
 *
 * Runs against a LIVE app pointed at by `C4S_E2E_BASE_URL` (normally an env-runner
 * environment); without it every case skips.
 *
 * The jump is what only a browser can check: the list used to navigate to
 * `#anchor-todo-N`, a hash the heading scroller silently ignores, so every click
 * landed at the top of the page with a clean 200. The page here puts its markers
 * far below the fold, so "landed on the page" and "scrolled to the marker" differ.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

interface TodoHit {
  rootId: string;
  pagePath: string;
  line: number;
  col: number;
  comment: string;
  anchor: string;
}

const PAGE_PATH = 'e2e-todos-jump.md';
const FILLER = Array.from({ length: 80 }, (_, i) => `Filler paragraph ${i + 1}.`).join('\n\n');
const BODY = `Intro line.\n\n${FILLER}\n\nPair: <todo comment="e2e first"/> and <todo comment="e2e second"/>\n\n${FILLER}\n\nLast: <todo comment=""/>\n`;

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

describe.skipIf(!BASE)('TODO list and jump to marker', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  let api: string;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  async function hits(): Promise<TodoHit[]> {
    const body = (await (await fetch(`${api}/todos`)).json()) as { todos: TodoHit[] };
    return body.todos.filter((t) => t.pagePath === PAGE_PATH);
  }

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    api = `${BASE}/api/projects/${project.id}`;
    await fetch(`${api}/pages/pages/${PAGE_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: BODY, expectedHash: 'a'.repeat(64) }),
    });
    // expect.poll is test-only; a plain wait for the index to catch up.
    for (let i = 0; i < 50 && (await hits()).length < 3; i++) await new Promise((r) => setTimeout(r, 100));

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`);
    });
  });

  afterAll(async () => {
    if (project) await fetch(`${api}/pages/pages/${PAGE_PATH}`, { method: 'DELETE' }).catch(() => {});
    await browser?.close();
  });

  it('[ac:ac-dwa-znaczniki-stojace-w-tej-samej-lin] indexes two markers on one line as separate hits with distinct anchors', async () => {
    const [first, second, last] = await hits();
    expect(first!.line).toBe(second!.line);
    expect(first!.anchor).toBe(`todo-${first!.line}`);
    expect(second!.anchor).toBe(`todo-${second!.line}-${second!.col}`);
    expect(last!.comment).toBe('');
  });

  it('[ac:ac-trafienia-na-stronie-zbiorczej-sa-pog] groups hits per root + file with the root label', async () => {
    await page.goto(`${BASE}/p/${project.id}/todos`, { waitUntil: 'networkidle' });
    const group = page.locator('[data-testid="todo-group"]', { hasText: PAGE_PATH });
    await expect.poll(() => group.count()).toBe(1);
    expect((await group.locator('[data-testid="todo-group-root"]').innerText()).trim().length).toBeGreaterThan(0);
    const text = await group.innerText();
    expect(text).toContain('e2e first');
    expect(text).toContain('e2e second');
    expect(text).toContain('(no comment)');
  });

  for (const [comment, ordinal] of [
    ['e2e second', 1],
    ['(no comment)', 2],
  ] as const) {
    it(`[ac:ac-klikniecie-trafienia-na-stronie-zbior] clicking "${comment}" opens the page in its root and scrolls to that marker`, async () => {
      await page.goto(`${BASE}/p/${project.id}/todos`, { waitUntil: 'networkidle' });
      const group = page.locator('[data-testid="todo-group"]', { hasText: PAGE_PATH });
      await group.locator('button', { hasText: comment }).first().click();

      await page.waitForURL(/\/space\/pages\/e2e-todos-jump\.md#anchor-todo-\d+/);
      const expected = (await hits())[ordinal]!;
      expect(new URL(page.url()).hash).toBe(`#${expected.anchor}`);

      const chip = page.locator('.ProseMirror [data-todo-chip]').nth(ordinal);
      await expect.poll(() => chip.count(), { timeout: 10000 }).toBe(1);
      await expect
        .poll(
          () =>
            chip.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= window.innerHeight;
            }),
          { timeout: 5000 },
        )
        .toBe(true);
    });
  }

  it('[ac:ac-usuniecie-pliku-zdejmuje-jego-znaczni] deleting the file removes its markers from the list', async () => {
    await fetch(`${api}/pages/pages/${PAGE_PATH}`, { method: 'DELETE' });
    await expect.poll(async () => (await hits()).length, { timeout: 5000 }).toBe(0);
  });

  it('logged no console errors and no failed responses along the way', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
