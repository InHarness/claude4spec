import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

/**
 * E2E: Settings "External Integrations" card (0.2.93).
 *
 * Runs against a LIVE app pointed at by `C4S_E2E_BASE_URL` (normally an
 * env-runner environment built from the branch under test); skips otherwise.
 *
 * What a route test cannot see: that the MCP block shows ONE snippet at a time
 * and a pill swaps it rather than stacking another, and that Copy puts the
 * server's snippet on the clipboard byte for byte.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
}

interface McpConfigResponse {
  variants: Array<{ id: string; label: string; snippet: string }>;
}

describe.skipIf(!BASE)('settings — External Integrations (0.2.93)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let projectId: string;
  let config: McpConfigResponse;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  beforeAll(async () => {
    const ws = (await (await fetch(`${BASE}/api/workspace`)).json()) as { projects: WorkspaceProject[] };
    const project = ws.projects[0];
    if (!project) throw new Error('no project registered in the environment');
    projectId = project.id;
    await fetch(`${BASE}/api/projects/${projectId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    const res = await fetch(`${BASE}/api/projects/${projectId}/_meta/mcp-config`);
    expect(res.status).toBe(200);
    config = (await res.json()) as McpConfigResponse;

    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${BASE}/p/${projectId}/settings#external-integrations`, { waitUntil: 'networkidle' });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('the route answers three server-rendered variants in presentation order', () => {
    expect(config.variants.map((v) => v.id)).toEqual(['http-project', 'http-workspace', 'stdio']);
    for (const v of config.variants) expect(v.snippet).toContain(projectId);
  });

  it('the card is renamed and sits between Entities and Plugin pool', async () => {
    const card = page.locator('#external-integrations');
    await expect.poll(() => card.count()).toBe(1);
    expect(await page.locator('#external-skills').count()).toBe(0);
    await expect.poll(() => card.getByRole('heading', { name: 'External Integrations' }).count()).toBe(1);
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('section[id]')].map((s) => s.id),
    );
    const at = (id: string) => order.indexOf(id);
    expect(at('entities')).toBeLessThan(at('external-integrations'));
    expect(at('external-integrations')).toBeLessThan(at('plugin-pool'));
    expect(at('about')).toBeLessThan(at('index-status'));
    expect(at('index-status')).toBeLessThan(at('danger-zone'));
    // No Save in the shared shell.
    expect(await card.getByRole('button', { name: /save/i }).count()).toBe(0);
  });

  it('one snippet at a time — a pill swaps it, Copy copies it verbatim', async () => {
    const card = page.locator('#external-integrations');
    const snippet = card.locator('[data-testid="mcp-config-snippet"]');
    await expect.poll(() => snippet.count()).toBe(1);
    expect(await snippet.textContent()).toBe(config.variants[0]!.snippet);

    for (const variant of config.variants) {
      await card.locator(`[data-testid="mcp-config-pill-${variant.id}"]`).click();
      expect(await snippet.count()).toBe(1);
      await expect.poll(() => snippet.textContent()).toBe(variant.snippet);
    }

    const last = config.variants[config.variants.length - 1]!;
    await card.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(last.snippet);
  });

  it('no console errors and no failed responses', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
