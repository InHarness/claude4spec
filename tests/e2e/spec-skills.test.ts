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

/**
 * 2.1.67 — M52 `uluzymnm` / `qtq9iusb`: the confirmation of attachment names on
 * the `#skills` card. A name is confirmed, not the list: an attached row without
 * a confirmation on this machine carries `Unconfirmed` and a "Confirm" action
 * (`PUT /api/spec-skills/uses-confirmation`), and a row ticked on the card is
 * confirmed together with the save.
 *
 * The environment need not hold a second, exposed project: the list
 * (`GET …/spec-skills/exposed-projects`) is stubbed to the state each case needs.
 * The first case stubs the confirmation write too; the second lets the save and
 * the confirmation hit the server, reads the real list back, and restores both.
 */
describe.skipIf(!BASE)('#skills — attachment confirmation (M52 uluzymnm, 2.1.67)', () => {
  let browser: Browser;
  let project: WorkspaceProject;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
  });
  afterAll(async () => {
    await browser?.close();
  });

  const listUrl = () => `**/api/projects/${project.id}/spec-skills/exposed-projects`;
  const confirmUrl = () => `**/api/projects/${project.id}/spec-skills/uses-confirmation`;

  it('[ac:ac-wiersz-niepotwierdzonego-podpiecia-na] the row of an unconfirmed attachment on the #skills card carries the Unconfirmed marker, and its Confirm action writes the name through PUT /uses-confirmation', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    const confirmedName = `e2e-confirmed-${suffix}`;
    const pendingName = `e2e-pending-${suffix}`;
    let confirmedNames = [confirmedName];
    const rows = () => [
      { name: confirmedName, description: 'Confirmed here.', projectId: 'e2e-a', uses: true, status: 'ok', confirmed: confirmedNames.includes(confirmedName) },
      { name: pendingName, description: 'Added by a commit.', projectId: 'e2e-b', uses: true, status: 'ok', confirmed: confirmedNames.includes(pendingName) },
    ];
    const writes: Array<{ names: string[] }> = [];
    await page.route(listUrl(), (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: rows() }) }),
    );
    await page.route(confirmUrl(), async (route) => {
      const body = route.request().postDataJSON() as { names: string[] };
      writes.push(body);
      confirmedNames = body.names;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: { confirmedSkillUses: body.names, notInSkillUses: [] } }),
      });
    });

    await page.goto(`${BASE}/p/${project.id}/settings#skills`, { waitUntil: 'networkidle' });
    const card = page.locator('section#skills');
    const pending = card.locator(`[data-skill-name="${pendingName}"]`);
    const confirmed = card.locator(`[data-skill-name="${confirmedName}"]`);
    await expect.poll(() => pending.count()).toBe(1);

    // The unconfirmed row is marked; the confirmed one is not.
    const marker = pending.locator('[data-marker="Unconfirmed"]');
    await expect.poll(() => marker.count()).toBe(1);
    expect((await marker.innerText()).trim().toLowerCase()).toBe('unconfirmed');
    expect(await confirmed.locator('[data-marker="Unconfirmed"]').count()).toBe(0);
    // The marker never disables the row's checkbox.
    const checkbox = pending.locator('input[type="checkbox"]');
    expect(await checkbox.isDisabled()).toBe(false);
    // The tick follows the card's draft of `skill.uses` (the real config), not the
    // stubbed rows: whatever it is now, Confirm must leave it as it is.
    const tickedBefore = await checkbox.isChecked();

    // The confirmation action: one write, the already confirmed name carried over.
    await pending.locator(`[data-confirm-skill-use="${pendingName}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.names).toEqual([confirmedName, pendingName]);
    // The list is re-read: the marker is gone, and the row's tick is unchanged (the click never toggles it).
    await expect.poll(() => marker.count()).toBe(0);
    expect(await checkbox.isChecked()).toBe(tickedBefore);

    expect(consoleErrors, 'console errors').toEqual([]);
    expect(badResponses, 'responses >= 400').toEqual([]);
    await page.close();
  });

  it('[ac:ac-podpiecie-dodane-na-karcie-skills-dzi] an attachment added on the #skills card works without a separate confirmation: the save writes skill.uses and the name\'s confirmation together, and the real list reads it confirmed', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleErrors, badResponses } = watch(page);
    const name = `e2e-added-${suffix}`;
    const configUrl = `${BASE}/api/projects/${project.id}/config`;
    const before = (await (await fetch(configUrl)).json()) as { skill?: { uses?: string[] } };
    const usesBefore = before.skill?.uses ?? [];

    // Until the save, the list offers one exposed project the current one does not attach.
    let stubbed = true;
    await page.route(listUrl(), async (route) => {
      if (!stubbed) return route.continue();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ name, description: 'An exposed project.', projectId: 'e2e-provider', uses: false, status: 'ok', confirmed: false }],
        }),
      });
    });
    const patches: unknown[] = [];
    const confirmations: Array<{ request: { names: string[] }; status: number; data: { confirmedSkillUses: string[]; notInSkillUses: string[] } }> = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/api/projects/${project.id}/config`)) {
        patches.push(r.postDataJSON());
        stubbed = false;
      }
    });
    // The confirmation write reaches the real server; its answer is read here, on
    // the test's side. Reading it from the page (`response.json()`) races a reload:
    // the write invalidates the project's context (M31), the server sends
    // `project:disposed` and the tab reloads, after which the browser no longer
    // holds the response body.
    await page.route(confirmUrl(), async (route) => {
      const request = route.request();
      if (request.method() !== 'PUT') return route.fallback();
      const response = await route.fetch();
      const body = (await response.json()) as { data: { confirmedSkillUses: string[]; notInSkillUses: string[] } };
      confirmations.push({ request: request.postDataJSON() as { names: string[] }, status: response.status(), data: body.data });
      // The page may already be reloading (the request is gone): nothing left to answer.
      await route.fulfill({ response }).catch(() => undefined);
    });

    try {
      await page.goto(`${BASE}/p/${project.id}/settings#skills`, { waitUntil: 'networkidle' });
      const card = page.locator('section#skills');
      const row = card.locator(`[data-skill-name="${name}"]`);
      await expect.poll(() => row.count()).toBe(1);
      // Not attached yet: no Unconfirmed marker, no Confirm action.
      expect(await row.locator('[data-marker="Unconfirmed"]').count()).toBe(0);
      expect(await row.locator('[data-confirm-skill-use]').count()).toBe(0);

      await row.locator('input[type="checkbox"]').check();
      await card.locator('[data-testid="settings-save-skills"]').click();

      // One save: skill.uses carries the name, and its confirmation follows — with no Confirm click.
      await expect.poll(() => confirmations.length, { timeout: 15_000 }).toBe(1);
      expect(patches).toHaveLength(1);
      expect((patches[0] as { skill?: { uses?: string[] } }).skill?.uses).toContain(name);
      expect(confirmations[0]!.status).toBe(200);
      expect(confirmations[0]!.request.names).toContain(name);
      expect(confirmations[0]!.data.confirmedSkillUses).toContain(name);
      expect(confirmations[0]!.data.notInSkillUses).not.toContain(name);

      // The list re-read from the server: the attachment is confirmed on this machine.
      const real = (await (await fetch(`${BASE}/api/projects/${project.id}/spec-skills/exposed-projects`)).json()) as {
        data: Array<{ name: string; uses: boolean; confirmed: boolean }>;
      };
      expect(real.data.find((r) => r.name === name)).toMatchObject({ uses: true, confirmed: true });
      // And the card never asks for a separate confirmation of it.
      await expect.poll(() => row.locator('[data-marker="Unconfirmed"]').count()).toBe(0);
      expect(await row.locator('[data-confirm-skill-use]').count()).toBe(0);

      expect(consoleErrors, 'console errors').toEqual([]);
      expect(badResponses, 'responses >= 400').toEqual([]);
    } finally {
      await page.close();
      // Restore the environment: the attachment list and the confirmations as they were.
      await fetch(configUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: { uses: usesBefore } }),
      });
      const restored = confirmations[0]?.data.confirmedSkillUses.filter((n) => n !== name);
      if (restored) {
        await fetch(`${BASE}/api/projects/${project.id}/spec-skills/uses-confirmation`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: restored }),
        });
      }
    }
  });
});
