import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: project skill packages (M52) — the `skills` root in the sidebar, the
 * composer's `spec-skills` command source and the `skill_ref` chip.
 *
 * Runs against a LIVE app pointed at by `C4S_E2E_BASE_URL` (normally an
 * env-runner environment built from the branch under test); without it every
 * case skips.
 *
 * The package is created the way a person creates one — through the page
 * routes of the `skills` root's facade — under a slug unique to this run, so
 * the file can run again on the same environment. Each case asserts what is
 * rendered, plus zero console errors and zero responses >= 400: the reducer,
 * the accordion route and the chat listing are all separate requests, and a
 * white shell answers 200 too.
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

function watch(page: Page) {
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { consoleErrors, badResponses };
}

describe.skipIf(!BASE)('project skill packages (M52)', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  const slug = `e2e-skill-${Date.now().toString(36)}`;
  const title = `E2E Skill ${slug.slice(-6)}`;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    const content = [
      '---',
      `title: ${title}`,
      'version: 1',
      'language: en',
      'description: Reviews a module page for the e2e suite.',
      'scope: contextual',
      'contextTypes: [chat]',
      '---',
      `# ${title}`,
      '',
      'Read the page, list three findings.',
      '',
    ].join('\n');
    const res = await fetch(`${BASE}/api/projects/${project.id}/pages/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${slug}/SKILL.md`, content }),
    });
    if (res.status !== 201) throw new Error(`POST /pages/skills → ${res.status}: ${await res.text()}`);
  });
  afterAll(async () => {
    await fetch(`${BASE}/api/projects/${project.id}/pages/skills/${slug}/SKILL.md`, { method: 'DELETE' }).catch(
      () => {},
    );
    await browser?.close();
  });

  it('[ac:m52-package-own-accordion] the package is its own sidebar accordion, labelled with its title, listing its files', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/`, { waitUntil: 'networkidle' });
    const header = page.locator(`button[title="${title}"]`);
    await expect.poll(() => header.count()).toBe(1);

    const file = page.locator(`a[href$="/space/skills/${slug}/SKILL.md"]`);
    if (!(await file.isVisible())) await header.click();
    await expect.poll(() => file.isVisible()).toBe(true);

    await file.click();
    await expect.poll(() => page.getByText('Read the page, list three findings.').count()).toBeGreaterThan(0);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('[ac:m52-skills-entry-narrows-popover] [ac:m52-skills-entry-shows-origin-marker] /skills narrows the composer popover to skills, each with its origin, and a pick inserts a live chip', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/`, { waitUntil: 'networkidle' });
    await page.locator('button[title="Open chat"]').click();
    const input = page.locator('.chat-input-pm');
    await expect.poll(() => input.count()).toBe(1);
    await input.click();
    await page.keyboard.type('/');

    const menu = page.locator('[data-slash-menu]');
    const skillsEntry = menu.locator('button', { hasText: '/skills' });
    await expect.poll(() => skillsEntry.count()).toBeGreaterThan(0);
    await skillsEntry.first().click();

    const item = menu.locator('button', { hasText: `/${slug}` });
    await expect.poll(() => item.count()).toBe(1);
    const labels = await menu.locator('button span.font-mono').allInnerTexts();
    expect(labels.some((l) => l.startsWith('/section')), 'built-in commands are gone from the narrowed view').toBe(
      false,
    );
    expect(await item.locator('[data-slash-origin]').innerText()).toMatch(/project-rooted/);

    await item.click();
    const chip = page.locator(`[data-skill-ref="${slug}"]`);
    await expect.poll(() => chip.getAttribute('data-skill-ref-state')).toBe('normal');

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('the settings #skills card renders the Used skill projects list', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);

    await page.goto(`${BASE}/p/${project.id}/settings#skills`, { waitUntil: 'networkidle' });
    const card = page.locator('section#skills');
    await expect.poll(() => card.getByText('Used skill projects').count()).toBeGreaterThan(0);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });
});
