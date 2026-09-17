import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: a backtick inside a reference tag's `caption` is not an inline-code
 * delimiter (0.2.92, M19/M20).
 *
 * The markdown-it unit test proves the token stream; this proves the rendered
 * editor — a caption backtick used to pair with a lone prose backtick earlier in
 * the paragraph, so half the tag became a `<code>` run and no card rendered.
 * Same fixture shape and the same boot workaround as `code-snippet.test.ts`
 * (cold load elsewhere, then client-side navigation).
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

const PAGE_PATH = 'e2e-caption-backtick.md';
const SLUG = 'e2e-backtick-snippet';

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

const api = (projectId: string, path: string) => `${BASE}/api/projects/${projectId}${path}`;

describe.skipIf(!BASE)('caption with backticks — chip, not code', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    await fetch(api(project.id, '/config'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    await fetch(api(project.id, '/code-snippets'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: SLUG, title: 'Backtick snippet', language: 'ts', code: 'const a = 1;' }),
    });
    await fetch(api(project.id, `/pages/pages/${PAGE_PATH}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedHash: 'a'.repeat(64),
        body:
          '# Caption backticks\n\n' +
          `<single_element type="code-snippet" slug="${SLUG}" caption="run \`make\` first"/>\n\n` +
          `Press \` then <single_element type="code-snippet" slug="${SLUG}" caption="the \` key"/> and later \`code\`.\n`,
      }),
    });

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const ours = (url: string | undefined) => Boolean(url && url.startsWith(BASE!));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && ours(msg.location()?.url)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('response', (res) => {
      if (res.status() >= 400 && ours(res.url())) failedResponses.push(`${res.status()} ${res.url()}`);
    });
    await page.goto(`${BASE}/p/${project.id}/pages/index.md`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    await page.getByText(PAGE_PATH, { exact: true }).first().click();
    await page.waitForTimeout(4000);
  });

  afterAll(async () => {
    if (project) {
      await fetch(api(project.id, `/pages/pages/${PAGE_PATH}`), { method: 'DELETE' }).catch(() => {});
      await fetch(api(project.id, `/code-snippets/${SLUG}`), { method: 'DELETE' }).catch(() => {});
    }
    await browser?.close();
  });

  it('[ac:m20-caption-backtick-chip] renders both backtick-caption tags as cards, never as literal code', async () => {
    const cards = page.locator(`[data-testid="code-snippet-card"][data-slug="${SLUG}"]`);
    await expect.poll(() => cards.count()).toBe(2);

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('<single_element');
    expect(body).not.toContain('caption=');
    // the real prose span still renders as code
    expect(await page.locator('.ProseMirror code', { hasText: /^code$/ }).count()).toBe(1);

    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });

  it('[ac:m19-caption-backtick-pair-resolved] find_references over REST counts both tags', async () => {
    const res = await fetch(api(project.id, `/references?type=code-snippet&slug=${SLUG}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { references: Array<{ pagePath?: string; path?: string }> };
    const onPage = body.references.filter((r) => (r.pagePath ?? r.path) === PAGE_PATH);
    expect(onPage).toHaveLength(2);
  });

  it('the sidebar counts aggregate answers and carries type names as keys', async () => {
    const res = await fetch(api(project.id, '/entities/counts'));
    expect(res.status).toBe(200);
    const counts = (await res.json()) as Record<string, number>;
    expect(counts['code-snippet']).toBeGreaterThanOrEqual(1);
    expect(Object.keys(counts).some((k) => /\(/.test(k))).toBe(false);
  });
});
