import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: `update_sections({ action: 'rename' })`, 0.2.100.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips.
 *
 * WHY THESE CASES AND NOT OTHERS. The action's mechanics are settled in
 * `page-write.test.ts` against a real section index, and repeating them here
 * would buy nothing. What no Vitest run can see is the chain BEYOND the splice:
 * the write goes through the reaction chain, the indexer re-reads the file and
 * the editor draws what it finds. Three things live only in that chain:
 *
 *   1. The heading a reader SEES changes. A green PATCH proves the server
 *      answered; it does not prove the page redrew, and a white SPA shell
 *      returns 200 to anything that only checks status codes.
 *   2. The old label is gone EVERYWHERE, the outline and the file tree
 *      included — a rename that updated the body but left a stale heading in a
 *      side panel is the failure a body-only assertion waves through.
 *   3. The anchor survives a real round-trip. The whole action exists so that
 *      identity outlives the label, and the indexer — not the splice — is what
 *      decides whether it did.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
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

/**
 * Console errors and >=400 responses — narrowed to THIS test's page.
 *
 * A blanket "zero errors on the whole SPA load" reads as a rename assertion but
 * measures the environment: these suites share one long-lived env-runner
 * environment, whose first load has a documented live-update socket self-abort
 * and whose catalog state other suites keep changing. Both go red for reasons
 * a rename cannot cause, in the one file whose job is to prove the rename
 * chain. So the filter keeps only what this test can be blamed for: anything
 * naming the page under test or the two endpoints it drives.
 */
function watch(page: Page, pagePath: string) {
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  const mine = (text: string) => text.includes(pagePath) || /\/(sections|pages)\b/.test(text);
  page.on('console', (m) => {
    if (m.type() === 'error' && mine(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (mine(e.message)) consoleErrors.push(`[pageerror] ${e.message}`);
  });
  page.on('response', (r) => {
    const { pathname } = new URL(r.url());
    if (r.status() >= 400 && mine(pathname)) badResponses.push(`${r.status()} ${pathname}`);
  });
  return { consoleErrors, badResponses };
}

describe.skipIf(!BASE)('update_sections — rename, end to end', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  let api: string;

  /** Unique per run: these suites share one environment and re-run against it. */
  const PAGE = `section-rename-e2e-${Date.now()}.md`;
  const SOURCE = [
    '# Rename end to end',
    '',
    '## Parent heading',
    '',
    'PARENT BODY MARKER',
    '',
    '### Child heading',
    '',
    'CHILD BODY MARKER',
    '',
  ].join('\n');

  /**
   * Resolved from the outline in every case that needs it, never carried over
   * from an earlier one: a case that reads an anchor another case assigned
   * fails as a bare `expected 400 to be 200` the moment it is run alone, or the
   * moment the case before it goes red.
   */
  async function anchorOf(
    flat: Array<{ anchor: string; heading: string }>,
    ...headings: string[]
  ): Promise<string> {
    const found = flat.find((s) => headings.includes(s.heading));
    expect(found, `no section titled ${headings.join(' or ')} in ${JSON.stringify(flat)}`).toBeDefined();
    return found!.anchor;
  }

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    api = `${BASE}/api/projects/${project.id}`;

    await fetch(`${api}/pages/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: PAGE, content: SOURCE }),
    });
  });

  afterAll(async () => {
    await fetch(`${api}/pages/pages/${PAGE}`, { method: 'DELETE' }).catch(() => {});
    await browser?.close();
  });

  /**
   * The outline, which carries the anchors AND the hash that arms the write —
   * so nothing here ever reads the page whole.
   */
  async function outline(): Promise<{ hash: string; flat: Array<{ anchor: string; heading: string }> }> {
    const res = await fetch(`${api}/pages/pages/outline?path=${encodeURIComponent(PAGE)}`);
    const body = (await res.json()) as {
      hash: string;
      sections: Array<{ anchor: string; heading: string; children?: unknown[] }>;
    };
    const flat = (nodes: any[]): any[] => (nodes ?? []).flatMap((n) => [n, ...flat(n.children)]);
    return { hash: body.hash, flat: flat(body.sections) };
  }

  /** Opens the project in THIS browser session — a cold tab lands on /welcome. */
  async function openPage(page: Page): Promise<void> {
    await page.goto(`${BASE}/welcome`, { waitUntil: 'networkidle' });
    await page.getByText(new RegExp(project.name)).first().click();
    await page.waitForTimeout(2000);
    await page.goto(`${BASE}/p/${project.id}/space/pages/${PAGE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  }

  it('[ac:ac-akcja-rename-zmienia-w-section-index] renames through the real indexer, keeping the anchor', async () => {
    const before = await outline();
    const childAnchor = await anchorOf(before.flat, 'Child heading');

    const res = await fetch(`${api}/sections`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: before.hash,
        edits: [{ anchor: childAnchor, action: 'rename', heading: 'Child heading, renamed' }],
      }),
    });
    expect(res.status).toBe(200);

    const row = ((await res.json()) as { results: Array<Record<string, unknown>> }).results[0]!;
    expect(row.previousHeading).toBe('Child heading');
    expect(row.droppedAnchors).toEqual([]);

    /**
     * Read back through the OUTLINE, which is the section index rather than the
     * file: the anchor is the same row, under a new label. That is the whole
     * claim of the action, and only a real indexing pass can make it.
     */
    const after = await outline();
    const renamed = after.flat.find((s) => s.anchor === childAnchor);
    expect(renamed?.heading).toBe('Child heading, renamed');
    expect(after.flat.map((s) => s.anchor).sort()).toEqual(before.flat.map((s) => s.anchor).sort());
  });

  it('[ac:ac-akcja-rename-zachowuje-poziom-naglowk] draws the new heading at the old level, with the body intact', async () => {
    const page = await browser.newPage();
    const { consoleErrors, badResponses } = watch(page, PAGE);
    try {
      await openPage(page);

      /**
       * Lower-cased before matching: the editor upper-cases headings in CSS, so
       * `innerText` hands back the rendered label rather than the file's.
       */
      const text = (await page.locator('body').innerText()).toLowerCase();
      expect(text, 'the renamed heading must be on the page').toContain('child heading, renamed');
      expect(text, 'the body belongs to the section, not to its label').toContain('child body marker');
      expect(text).toContain('parent body marker');

      // The level is the section's place in the outline, and the outline pane
      // is where a wrong one shows: a `###` promoted to `##` re-parents it.
      const level = await page.evaluate(() => {
        const h = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((el) =>
          /child heading, renamed/i.test(el.textContent ?? ''),
        );
        return h?.tagName ?? null;
      });
      expect(level).toBe('H3');

      expect(consoleErrors).toEqual([]);
      expect(badResponses).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('[ac:ac-powtorzone-rename-z-tym-samym-tekstem] leaves no trace of the previous label anywhere on the page', async () => {
    // Replay first: idempotent by heading text, so this settles the page rather
    // than changing it — and proves the repeat is not a FIND_NOT_FOUND.
    const before = await outline();
    /**
     * Either label: run after the first case the child is already renamed, run
     * alone it still carries its original heading — and the write below is the
     * same one either way, which is the point of an idempotent action.
     */
    const childAnchor = await anchorOf(before.flat, 'Child heading, renamed', 'Child heading');
    const replay = await fetch(`${api}/sections`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: before.hash,
        edits: [{ anchor: childAnchor, action: 'rename', heading: 'Child heading, renamed' }],
      }),
    });
    expect(replay.status).toBe(200);

    const page = await browser.newPage();
    try {
      await openPage(page);
      const text = (await page.locator('body').innerText()).toLowerCase();
      /**
       * `child heading, renamed` contains `child heading`, so the stale label
       * has to be looked for as a whole WORD-boundary match that is not the new
       * one — a plain `includes` would pass on the renamed heading itself.
       */
      const stale = text.replaceAll('child heading, renamed', '');
      expect(stale, 'the outline, the tree and the body must all carry the new label').not.toContain(
        'child heading',
      );
    } finally {
      await page.close();
    }
  });
});
