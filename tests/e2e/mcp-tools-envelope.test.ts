import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: the `mcp-tool` type, contributed by the `c4s-plugin-mcp-tools` envelope.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * WHY THESE CASES AND NOT OTHERS. A new envelope has one failure mode that no
 * Vitest run can see: the built bundle never reaches the runtime image, and
 * `discoverBuiltinEnvelopes()` answers `[]` for a missing artifact — no error,
 * no warning, no failing request. The type is simply absent, and the page
 * returns a 200 HTML shell to anything that only checks status codes.
 *
 * Beyond that, two behaviours of THIS type are worth holding still over time,
 * and both are invisible to the unit suite because they are decisions made while
 * rendering:
 *
 *   1. The GROUPED list. `/mcp-tools` groups by the `server` field by default
 *      and flattens on a toggle carried in the URL. This is the first grouped
 *      list in the product, drawn by a brand-new kit component.
 *   2. The THREE-STATE hint. An undeclared annotation must not render as a
 *      declared `false`. The value crosses SQLite (integer), the entity file
 *      (integer) and JSON before reaching a renderer, and a declared `false`
 *      arrives falsy — so the collapse is one `if (hint)` away at every step.
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

/** Console errors and >=400 responses, collected for the whole page lifetime. */
function watch(page: Page) {
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { consoleErrors, badResponses };
}

describe.skipIf(!BASE)('mcp-tool — the envelope end to end', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  let api: string;

  /**
   * Three servers, one of them holding a single tool: the smallest corpus in
   * which grouping is observable at all AND in which heading order is checkable.
   *
   * One tool carries an ordinary tag and the others carry none, which is the
   * point — tags are an author's deliberate choice here, and grouping must not
   * consult them either way.
   */
  const TOOLS = [
    {
      name: 'read_page',
      server: 'alpha',
      description: 'Read one specification page by path.',
      params: [{ name: 'path', type: 'string', required: true, description: 'Page path.' }],
      returns: 'The page body as markdown.',
      readOnlyHint: true,
      destructiveHint: false,
      logic: 'Resolve the path, refuse anything escaping the root, then read.',
      tags: ['protocol'],
    },
    {
      name: 'write_page',
      server: 'alpha',
      description: 'Replace the body of one page.',
      params: [],
    },
    {
      name: 'list_envs',
      server: 'beta',
      description: 'List every environment currently up.',
      params: [],
    },
    // A third server holding exactly one tool — the group that proves heading
    // order is by server name and not by how many tools a server happens to have.
    { name: 'solo_tool', server: 'gamma', description: 'The only tool of its server.' },
  ];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    api = `${BASE}/api/projects/${project.id}/mcp-tools`;

    for (const tool of TOOLS) {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tool),
      });
      // 409 means a previous run of this suite already seeded it — fine.
      if (!res.ok && res.status !== 409) {
        throw new Error(`seeding ${tool.server}/${tool.name} failed: ${res.status} ${await res.text()}`);
      }
    }
  });
  afterAll(async () => {
    await browser?.close();
  });

  const body = (page: Page) => () => page.locator('body').innerText();

  it('registers the type at all — the envelope reached the runtime image', async () => {
    // The cheapest proof, and the one that fails when nothing else can: a
    // missing envelope leaves no route, no table and no router behind it.
    const res = await fetch(api);
    expect(res.status, 'GET /api/.../mcp-tools').toBe(200);
    const { data } = (await res.json()) as { data: Array<{ slug: string }> };
    expect(data.length).toBeGreaterThanOrEqual(TOOLS.length);
  });

  it('shows the MCP Tools tab and the list, grouped by server by default', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/mcp-tools`, { waitUntil: 'networkidle' });

    // Polled: the plugin bundle boots after first paint, and until it does the
    // route does not exist. Positive conditions only — see the note below.
    await expect.poll(body(page)).toMatch(/MCP Tools/);
    await expect.poll(body(page)).toMatch(/\d+\s+results?/i);

    // The group headings ARE the server names, and both servers are present.
    await expect.poll(body(page)).toMatch(/alpha/);
    await expect.poll(body(page)).toMatch(/beta/);
    // The tools themselves, drawn under them.
    await expect.poll(body(page)).toMatch(/read_page/);
    await expect.poll(body(page)).toMatch(/list_envs/);

    /**
     * The third server, and the assertion that grouping reads the FIELD: nothing
     * tagged this tool, and it still lands under a heading of its own.
     */
    await expect.poll(body(page)).toMatch(/gamma/);
    await expect.poll(body(page)).toMatch(/solo_tool/);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('flattens on the toggle, and the mode survives a reload because it is in the URL', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/mcp-tools`, { waitUntil: 'networkidle' });
    await expect.poll(body(page)).toMatch(/read_page/);

    await page.getByRole('button', { name: 'Flat list' }).click();

    // The toggle is in the URL, which is the whole reason it was put there: a
    // pasted link reproduces the screen.
    await expect.poll(() => page.url()).toMatch(/group=flat/);
    // The button now offers the way back.
    await expect.poll(body(page)).toMatch(/Group by server/);

    // Reload: a mode kept in component state would be lost here.
    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(() => page.url()).toMatch(/group=flat/);
    await expect.poll(body(page)).toMatch(/read_page/);
    await expect.poll(body(page)).toMatch(/Group by server/);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('renders the detail page with the contract separated from the logic', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/mcp-tools/alpha-read-page`, {
      waitUntil: 'networkidle',
    });

    // Poll FOR the page, never against the failure: `expect.poll` retries until
    // the assertion PASSES, so a negative matcher is satisfied by the very first
    // sample — the pre-hydration shell, which contains no text at all. Waiting
    // for the slug is a positive condition only the rendered panel satisfies.
    await expect.poll(body(page)).toMatch(/alpha-read-page/);
    expect(await page.locator('body').innerText()).not.toMatch(/not found/i);

    // The boundary this panel exists to make visible: contract above, logic
    // below, each under its own heading.
    await expect.poll(body(page)).toMatch(/Contract/i);
    await expect.poll(body(page)).toMatch(/transferred verbatim/i);
    await expect.poll(body(page)).toMatch(/Logic/i);
    await expect.poll(body(page)).toMatch(/Never sent to the model/i);

    // The contract's own fields. `description` and the parameter rows are
    // EDITABLE, so they live in form controls — and `innerText` never returns a
    // control's value. Reading them the way a user sees them means asking the
    // control, not the document; asserting on body text here passes vacuously
    // for a heading and fails for the value it was meant to check.
    await expect
      .poll(() =>
        page.locator('textarea').evaluateAll((els) =>
          (els as HTMLTextAreaElement[]).map((e) => e.value),
        ),
      )
      .toContain('Read one specification page by path.');
    await expect.poll(body(page)).toMatch(/Parameters/i);
    // The one parameter this tool declares, in the params editor.
    await expect.poll(() => page.locator('input[value="path"]').count()).toBeGreaterThan(0);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('renders an undeclared annotation hint as "not declared", never as false', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/mcp-tools/alpha-read-page`, {
      waitUntil: 'networkidle',
    });
    await expect.poll(body(page)).toMatch(/alpha-read-page/);

    // `alpha/read_page` carries all three states at once: `readOnlyHint: true`,
    // `destructiveHint: false`, and two hints never declared. The control draws
    // three buttons per hint with the active one pressed, so the assertion is on
    // WHICH is active, not on the labels merely existing.
    const active = (hint: string, option: string) =>
      page
        .locator(`text=${hint}`)
        .locator('xpath=..')
        .getByRole('button', { name: option, exact: true });

    // Undeclared: "Not declared" is the selected option.
    await expect.poll(async () => {
      const el = active('Open world', 'Not declared');
      return el.evaluate((n) => getComputedStyle(n).fontWeight);
    }).toBe('600');

    // Declared false: "No" is selected — and crucially NOT "Not declared".
    await expect.poll(async () => {
      const el = active('Destructive', 'No');
      return el.evaluate((n) => getComputedStyle(n).fontWeight);
    }).toBe('600');

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('deep-links the history route and renders the shared version block', async () => {
    // A plugin frontend boots after first paint, so a plugin-contributed route
    // does not exist when a hard refresh lands. Rendering "not found" there
    // reports a working link as broken.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/mcp-tools/alpha-read-page/history`, {
      waitUntil: 'networkidle',
    });

    await expect.poll(body(page)).toMatch(/alpha-read-page/);
    expect(await page.locator('body').innerText()).not.toMatch(/not found/i);
    await expect.poll(body(page)).toMatch(/History/i);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });
});
