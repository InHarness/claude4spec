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

/**
 * The slug the host derives at create: `{slugify(server)}-{slugify(name)}`. Kept
 * here so a re-seed can address a record it did not create.
 */
function slugFor(tool: { server: string; name: string }): string {
  const part = (v: string) =>
    v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${part(tool.server)}-${part(tool.name)}`;
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
      if (res.ok) continue;

      /*
        A 409 means the slug is taken — an environment reused across runs. It is
        NOT enough to shrug and continue: what is already there may not be what
        this suite asserts. A record left over from an earlier run, or edited by
        hand while someone was looking at the screen, will fail assertions that
        are perfectly correct about the code. So the existing record is written
        back to the intended state instead of being trusted.
      */
      if (res.status === 409) {
        const patch = await fetch(`${api}/${slugFor(tool)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tool),
        });
        if (!patch.ok) {
          throw new Error(
            `re-seeding ${tool.server}/${tool.name} failed: ${patch.status} ${await patch.text()}`,
          );
        }
        continue;
      }
      throw new Error(`seeding ${tool.server}/${tool.name} failed: ${res.status} ${await res.text()}`);
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

    /*
      The group headings ARE the server names. Case-INSENSITIVE, and that matters:
      the headings are uppercased by the kit, so a case-sensitive /alpha/ does not
      match one. It used to pass anyway, because every tool carried a lowercase
      `srv-alpha` tag chip — i.e. the assertion was green on the tag it was meant
      to be independent of. Dropping the mirror tag exposed that.
    */
    await expect.poll(body(page)).toMatch(/alpha/i);
    await expect.poll(body(page)).toMatch(/beta/i);
    // The tools themselves, drawn under them.
    await expect.poll(body(page)).toMatch(/read_page/);
    await expect.poll(body(page)).toMatch(/list_envs/);

    /**
     * The third server, and the assertion that grouping reads the FIELD: nothing
     * tagged this tool, and it still lands under a heading of its own.
     */
    await expect.poll(body(page)).toMatch(/gamma/i);
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

    // The contract's own fields. These are EDITABLE, so they live in controls —
    // and `innerText` never returns a control's value. Reading them the way a
    // user sees them means asking the control, not the document; asserting on
    // body text passes vacuously for a heading and fails for the value it was
    // meant to check.
    //
    // `description` is a `DocEditor`, so the control is a contenteditable and
    // not a `textarea`: it renders into `.prose-spec`, which is also the proof
    // that the rich editor mounted at all rather than falling back to a box.
    await expect
      .poll(() => page.locator('.prose-spec').first().innerText())
      .toMatch(/Read one specification page by path\./);
    // Tags first under the title, description second — the order this panel is
    // supposed to hold. `indexOf` on the rendered text is enough: both labels
    // are unique on the screen.
    await expect.poll(async () => {
      const text = await page.locator('body').innerText();
      return text.indexOf('Tags') < text.indexOf('Description');
    }).toBe(true);
    await expect.poll(body(page)).toMatch(/Parameters/i);
    // The one parameter this tool declares, in the params editor.
    await expect.poll(() => page.locator('input[value="path"]').count()).toBeGreaterThan(0);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  /**
   * Opening a record must not change it.
   *
   * This is the one regression that leaves no trace a normal check would catch:
   * no console error, no response >= 400, nothing wrong on screen. The panel
   * autosaves without a Save button, and `DocEditor` normalises its content
   * through tiptap — so an editor that emits its normalised spelling on mount
   * turns every VISIT into a write: a new version, a new `updatedAt`, a line in
   * the release diff, for a record nobody edited.
   */
  it('writes nothing when a tool is merely opened', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    const writes: string[] = [];
    page.on('request', (req) => {
      const method = req.method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      // The onboarding PATCH in `firstProject` is not on this page, but tag and
      // config traffic could be — only entity writes are the subject here.
      if (/\/api\/projects\/[^/]+\/mcp-tools/.test(req.url())) writes.push(`${method} ${req.url()}`);
    });

    await page.goto(`${BASE}/p/${project.id}/mcp-tools/alpha-read-page`, {
      waitUntil: 'networkidle',
    });
    await expect.poll(body(page)).toMatch(/alpha-read-page/);
    await expect.poll(() => page.locator('.prose-spec').count()).toBeGreaterThan(0);

    // Past the 500 ms autosave debounce, with margin: a write scheduled at mount
    // has had every chance to fire by now.
    await page.waitForTimeout(2000);

    expect(writes, 'entity writes on a plain view').toEqual([]);
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
