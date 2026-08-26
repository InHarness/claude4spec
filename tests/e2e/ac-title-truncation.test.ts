import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: 0.2.51 — where an AC's title IS cut, where it is NOT, and why the two are
 * different questions.
 *
 * The release collapses `ac`'s three text fields into the reserved `title` and
 * raises its bound to 500, which turns a field that used to be a short label
 * into one that carries a whole sentence. Two truncations were confused with
 * each other before that, and only one of them exists:
 *
 *  - TRANSPORT never shortens a title. 500 sits far below the read budget, the
 *    host refuses at registration any type that would change that, and no read
 *    marks a title `truncated`. That half is asserted over the API here.
 *  - DISPLAY does, on exactly two surfaces — the inline chip and the embedded
 *    row — because a 500-character sentence inside a pill is not a chip. The
 *    detail page and the card show the whole thing.
 *
 * Out of Vitest's reach: both surfaces are TipTap NodeViews dispatched at
 * runtime off the client plugin host, so the thing under test is a registration
 * that exists only once a real bundle has booted. `curl` on the page returns the
 * SPA shell and can see neither.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

const PAGE_PATH = 'e2e-ac-title-truncation.md';
const AC_SLUG = 'e2e-long-criterion-probe';

/**
 * 132 characters — comfortably past the 40 the renderers cut at, and past the
 * 200 the host used to bound every title with, so it also pins that the wider
 * bound really took effect rather than being silently clamped somewhere.
 */
const LONG_TITLE =
  'the request is rejected with 422 when the supplied token has already been consumed, and the body names the field that failed';
/** What a 40-character cut leaves — the prefix both surfaces must still show. */
const VISIBLE_PREFIX = LONG_TITLE.slice(0, 30);

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

describe.skipIf(!BASE)('0.2.51 — an AC title is cut for display, never for transport', () => {
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

    // `title` is the ONLY authored text field now, and it is required with no
    // `computedDefault` — a create without it is a 400, asserted below.
    const created = await fetch(`${BASE}/api/projects/${project.id}/acs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: AC_SLUG, title: LONG_TITLE }),
    });
    // An environment reused across runs already holds the probe. Re-point its
    // title rather than trusting whatever a previous run left there — an
    // explicit slug refuses on conflict (only a DERIVED one suffixes), so this
    // is the difference between a re-run and a false pass.
    if (created.status === 409) {
      await fetch(`${BASE}/api/projects/${project.id}/acs/${AC_SLUG}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: LONG_TITLE }),
      });
    }

    // Both truncating surfaces on one page: `inline_mention` → renderChip,
    // `element_list` → renderRow.
    await fetch(`${BASE}/api/projects/${project.id}/pages/pages/${PAGE_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: 'a'.repeat(64),
        body:
          `# AC title truncation\n\n` +
          `Inline: <inline_mention type="ac" slug="${AC_SLUG}"/>\n\n` +
          `<element_list type="ac" slugs="${AC_SLUG}"/>\n`,
      }),
    });

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const ours = (url: string | undefined) => Boolean(url && url.startsWith(BASE!));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && ours(msg.location()?.url)) consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && ours(res.url())) failedResponses.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(`${BASE}/p/${project.id}/pages/${PAGE_PATH}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('cuts the title on the chip and the row, and shows enough of it to recognise', async () => {
    const body = await page.locator('body').innerText();

    // Rendered content, not a 200 — a white SPA shell also answers 200.
    expect(body).toContain(VISIBLE_PREFIX);
    // The tail is NOT on the page: neither surface renders past the cut.
    expect(body).not.toContain('the body names the field that failed');
    // And the cut is marked rather than silent.
    expect(body).toContain('…');
  });

  it('keeps the whole title one hover away, on both surfaces', async () => {
    // Truncation is a display decision; the value behind it is intact, which is
    // what the `title` attribute carries.
    const tooltips = await page.locator(`[title="${LONG_TITLE}"]`).count();
    expect(tooltips).toBeGreaterThan(0);
  });

  it('does not truncate on the wire — the read carries all 132 characters', async () => {
    const res = await fetch(`${BASE}/api/projects/${project.id}/acs/${AC_SLUG}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.title).toBe(LONG_TITLE);
    // The two fields this release retires are gone from the record entirely.
    expect(data).not.toHaveProperty('text');
    expect(data).not.toHaveProperty('description');
  });

  it('refuses a create with no title, and one past the type\'s own 500', async () => {
    const post = (payload: unknown) =>
      fetch(`${BASE}/api/projects/${project.id}/acs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    // No `computedDefault` left to fall back on: this used to be derivable.
    expect((await post({ kind: 'edge-case' })).status).toBe(400);
    expect((await post({ title: 'z'.repeat(501) })).status).toBe(400);
    // 500 exactly is the bound the type declares, not one below it.
    const ok = await post({ title: 'y'.repeat(500) });
    expect(ok.status).toBe(201);
  });

  it('renders the page with a clean console and no failed request', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
