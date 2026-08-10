import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the page editor keeps its content across a save, now that a write no
 * longer answers with the page.
 *
 * Out of Vitest's reach on purpose. `useWritePage` used to seed the
 * `['page', …]` query cache with the write's own response; that response is
 * echo-free now, so the hook invalidates and the editor re-reads. If the
 * re-read were wired wrong the editor would blank out immediately after a save
 * — and a green PUT proves nothing about it, because the server's half of that
 * exchange is correct either way.
 *
 * The console-error and failed-response assertions are the cheap half and have
 * caught more than the explicit ones: a page that renders can still be firing
 * 404s behind the shell.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

const PAGE_PATH = 'e2e-editor-save.md';
const MARKER = 'EDITOR SAVE MARKER';

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

describe.skipIf(!BASE)('page editor — content survives a save', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await fetch(`${BASE}/api/projects/${project.id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    // 0.2.15 — `expectedHash` is mandatory. The page does not exist yet, so any
    // value passes the guard: there is nothing to be stale against.
    await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: `# Editor save\n\n${MARKER}\n`, expectedHash: 'a'.repeat(64) }),
    });

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`);
    });
    await page.goto(`${BASE}/p/${project.id}/pages/${PAGE_PATH}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  });

  afterAll(async () => {
    if (project) {
      await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    await browser?.close();
  });

  it('a write answers with the delta, carrying neither body nor frontmatter', async () => {
    const current = (await (
      await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`)
    ).json()) as { hash: string };
    const res = await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: `# Editor save\n\n${MARKER}\n`, expectedHash: current.hash }),
    });
    const ack = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(ack).sort()).toEqual(['changedAnchors', 'hash', 'version']);
    expect(JSON.stringify(ack)).not.toContain(MARKER);
  });

  /**
   * 0.2.15 — the read side has to be able to arm the write side's guard.
   *
   * `expectedHash` became mandatory on `update_page`, and the reason it had been
   * left optional was not that the editor forgot to send one: `GET .../pages/*`
   * returned no hash at all, so no browser caller could have sent one. This is
   * the case that fails if that read regresses — and it fails BEFORE the editor
   * does, which is the point, since the editor's symptom would be "saving
   * stopped working" with no obvious cause.
   */
  it('[ac:ac-crud-stron-dziala-przez-ui-i-wbudowane-n] the page read returns the hash the write requires', async () => {
    const read = (await (
      await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`)
    ).json()) as { hash?: string };
    expect(read.hash).toMatch(/^[0-9a-f]{64}$/);

    // Missing → INVALID_ARGUMENT, and the page is untouched.
    const unguarded = await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '# Clobbered\n' }),
    });
    expect(unguarded.status).toBe(400);
    expect((await unguarded.json()).error.code).toBe('INVALID_ARGUMENT');

    // Stale → PAGE_CONFLICT (409) carrying the current hash, which is the remedy.
    const stale = await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '# Clobbered\n', expectedHash: 'b'.repeat(64) }),
    });
    expect(stale.status).toBe(409);
    const conflict = await stale.json();
    expect(conflict.error.code).toBe('PAGE_CONFLICT');

    const after = (await (
      await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`)
    ).json()) as { body: string };
    expect(after.body).toContain(MARKER);
  });

  it('still shows the page after typing into it, and persists the edit', async () => {
    const editor = page.locator('.ProseMirror').first();
    await expect.poll(() => editor.count()).toBeGreaterThan(0);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' EDITED');
    // The editor debounces its save; give it room to land.
    await page.waitForTimeout(3000);

    // The regression this case exists for: a blank editor right after the save.
    expect(await page.locator('body').innerText()).toContain(MARKER);

    const onDisk = (await (
      await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`)
    ).json()) as { body: string };
    expect(onDisk.body).toContain('EDITED');
  });

  it('re-reads the page after a reload, showing the saved edit', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const text = await page.locator('body').innerText();
    expect(text).toContain(MARKER);
    expect(text).toContain('EDITED');
  });

  it('logged no console errors and no failed responses along the way', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
