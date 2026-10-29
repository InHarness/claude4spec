import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { RunnerHostStub } from '../helpers/runner-host-stub.js';

/**
 * E2E: the `#runner-hosts` card of the workspace settings page (2.1.62, M54 L5
 * `wzku2ck1`, L17 `cx6b7xjn` / `eqge2a8m`).
 *
 * Runs against a LIVE app pointed at by `C4S_E2E_BASE_URL` (normally an
 * env-runner environment built from the branch under test); skips otherwise.
 *
 * Every runner host here is a local HTTP stub started by the test (`GET /host`,
 * `GET /host/events` as an event stream) — never a real `c4s-runner`. It binds
 * every interface; the address the APP uses to reach it is
 * `http://<C4S_E2E_RUNNER_STUB_HOST>:<port>`, loopback by default (the test and
 * the app share a machine). The hosts are added through the real
 * `/api/workspace/runner-hosts`, so the app's supervisor really connects; what
 * the card shows is read in a real browser. Every host added is removed after
 * the suite.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');
const STUB_HOST = process.env.C4S_E2E_RUNNER_STUB_HOST ?? '127.0.0.1';
const API = `${BASE}/api/workspace/runner-hosts`;

/** The card polls every 5 s; a status change must show within a few polls. */
const SEEN_WITHIN_MS = 20_000;

interface HostDto {
  id: string;
  status: string;
  binding: { hostId: string; hostName: string } | null;
}

describe.skipIf(!BASE)('workspace settings — Runner hosts card (2.1.62, M54)', () => {
  let browser: Browser;
  let page: Page;
  let projectId: string;
  const stubs: RunnerHostStub[] = [];
  const hostIds: string[] = [];

  /** A fresh stub host, reachable from the app. */
  async function startStub(): Promise<RunnerHostStub> {
    const stub = await RunnerHostStub.start('0.0.0.0');
    stubs.push(stub);
    return stub;
  }

  const urlOf = (stub: RunnerHostStub) => `http://${STUB_HOST}:${stub.port}`;

  /** A master token with a recognisable tail (`c4sr_` prefix, `c4s-runner` M02). */
  const tokenEndingWith = (last4: string) => `c4sr_${randomBytes(12).toString('hex')}${last4}`;

  /** Add a host through the real route; the app's supervisor connects to the stub. */
  async function addHost(stub: RunnerHostStub, token: string, label?: string): Promise<HostDto> {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlOf(stub), token, ...(label ? { label } : {}) }),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: HostDto };
    hostIds.push(data.id);
    return data;
  }

  const row = (id: string) => page.locator(`[data-testid="runner-host-row"][data-host-id="${id}"]`);
  const statusOf = (id: string) => row(id).locator('[data-testid="runner-host-status"]').textContent();

  async function openWorkspaceSettings(): Promise<void> {
    await page.goto(`${BASE}/workspace/settings#runner-hosts`, { waitUntil: 'load' });
    await expect.poll(() => page.locator('#runner-hosts [data-testid="runner-hosts"]').count(), { timeout: 15_000 }).toBe(1);
  }

  beforeAll(async () => {
    const ws = (await (await fetch(`${BASE}/api/workspace`)).json()) as { projects: Array<{ id: string }> };
    const project = ws.projects[0];
    if (!project) throw new Error('no project registered in the environment');
    projectId = project.id;
    await fetch(`${BASE}/api/projects/${projectId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    browser = await chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  }, 60_000);

  afterAll(async () => {
    for (const id of hostIds) await fetch(`${API}/${id}`, { method: 'DELETE' }).catch(() => undefined);
    for (const stub of stubs) await stub.close();
    await browser?.close();
  });

  it('[ac:ac-karta-runner-hosts-renderuje-sie-na-w] the #runner-hosts card renders on /workspace/settings', async () => {
    await openWorkspaceSettings();
    const card = page.locator('section#runner-hosts');
    expect(await card.count()).toBe(1);
    expect(await card.getByRole('heading', { name: 'Runner hosts' }).count()).toBe(1);
    expect(await card.locator('[data-testid="runner-hosts-note"]').textContent()).toBe(
      'Tokens sent to http:// addresses travel unencrypted.',
    );
    // Integrations stands between Account (Appearance) and Plugins (Plugin pool).
    const order = await page.evaluate(() => [...document.querySelectorAll('section[id]')].map((s) => s.id));
    expect(order.indexOf('appearance')).toBeLessThan(order.indexOf('runner-hosts'));
    expect(order.indexOf('runner-hosts')).toBeLessThan(order.indexOf('plugin-pool'));
  });

  it('[ac:ac-karta-runner-hosts-nie-renderuje-sie] the #runner-hosts card does not render on the project /settings', async () => {
    const asked: string[] = [];
    const onRequest = (r: { url(): string }) => {
      if (r.url().includes('/runner-hosts')) asked.push(r.url());
    };
    page.on('request', onRequest);
    try {
      await page.goto(`${BASE}/p/${projectId}/settings`, { waitUntil: 'load' });
      // The project page is up: its own cards are there.
      await expect.poll(() => page.locator('section#about').count(), { timeout: 15_000 }).toBe(1);
      expect(await page.locator('#runner-hosts').count()).toBe(0);
      expect(await page.getByRole('heading', { name: 'Runner hosts' }).count()).toBe(0);
      expect(asked).toEqual([]);
    } finally {
      page.off('request', onRequest);
    }
  });

  it('[ac:ac-token-w-liscie-jest-maskowany-last4] the token in the list is masked as ••••<last4>', async () => {
    const stub = await startStub();
    const token = tokenEndingWith('Wq7z');
    const host = await addHost(stub, token, 'masked box');
    await openWorkspaceSettings();
    await expect.poll(() => row(host.id).count(), { timeout: SEEN_WITHIN_MS }).toBe(1);
    expect(await row(host.id).locator('[data-testid="runner-host-token"]').textContent()).toBe('••••Wq7z');
    // The token itself is nowhere on the page.
    const text = await page.locator('body').innerText();
    expect(text).not.toContain(token);
    expect(text).not.toContain(token.slice(0, -4));
  });

  it('[ac:ac-bind-to-this-host-jest-widoczny-tylko] [Bind to this host] is visible only at the status Different host', async () => {
    const stub = await startStub();
    stub.hostInfo = { ...stub.hostInfo, hostId: 'h_e2e_first', name: 'e2e-first' };
    const host = await addHost(stub, tokenEndingWith('b1nd'));
    expect(host.status).toBe('connected');
    await openWorkspaceSettings();
    const bind = row(host.id).getByRole('button', { name: 'Bind to this host' });

    await expect.poll(() => statusOf(host.id), { timeout: SEEN_WITHIN_MS }).toBe('Connected');
    expect(await bind.count()).toBe(0);

    // The host's identity changes while the token stays: a test sees another hostId.
    stub.hostInfo = { ...stub.hostInfo, hostId: 'h_e2e_second', name: 'e2e-second' };
    await row(host.id).getByRole('button', { name: 'Test connection' }).click();
    await expect.poll(() => statusOf(host.id), { timeout: SEEN_WITHIN_MS }).toBe('Different host');
    expect(await bind.count()).toBe(1);
    // No other row offers it unless it is at Different host itself.
    const offering = await page
      .locator('[data-testid="runner-host-row"]')
      .evaluateAll((rows) =>
        rows
          .filter((r) => [...r.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Bind to this host'))
          .map((r) => r.getAttribute('data-status')),
      );
    expect(new Set(offering)).toEqual(new Set(['other-host']));

    // Binding to it leaves Different host — and the action goes with it.
    await bind.click();
    await expect.poll(() => statusOf(host.id), { timeout: SEEN_WITHIN_MS }).toBe('Connected');
    expect(await bind.count()).toBe(0);
  });

  it('[ac:ac-po-restarcie-runnera-wiersz-pokazuje] after a runner restart the row shows the Restarted marker', async () => {
    const stub = await startStub();
    const host = await addHost(stub, tokenEndingWith('rst1'));
    expect(host.status).toBe('connected');
    await openWorkspaceSettings();
    const marker = row(host.id).locator('[data-testid="runner-host-restarted"]');
    await expect.poll(() => statusOf(host.id), { timeout: SEEN_WITHIN_MS }).toBe('Connected');
    expect(await marker.count()).toBe(0);

    // The runner restarts: same hostId, a new startedAt, the stream drops and comes back.
    stub.hostInfo = { ...stub.hostInfo, startedAt: new Date(Date.now() + 1_000).toISOString() };
    stub.dropStreams();

    await expect.poll(() => marker.count(), { timeout: SEEN_WITHIN_MS }).toBe(1);
    expect(await marker.textContent()).toMatch(/^Restarted /);
    expect(await statusOf(host.id)).toBe('Connected');
  });

  it('[ac:ac-przy-statusie-token-rejected-wiersz-p] at Token rejected the row shows the hint to test again after the fix on the host', async () => {
    const stub = await startStub();
    // The runner accepts another token only: every request with ours gets 401.
    stub.acceptedToken = tokenEndingWith('othr');
    const host = await addHost(stub, tokenEndingWith('rjct'));
    expect(host.status).toBe('token-rejected');
    await openWorkspaceSettings();
    await expect.poll(() => statusOf(host.id), { timeout: SEEN_WITHIN_MS }).toBe('Token rejected');
    expect(await row(host.id).locator('[data-testid="runner-host-token-rejected-hint"]').textContent()).toBe(
      'The runner rejected the token, or cannot read its token store. Fix it on the host, then use Test connection.',
    );
    // A connected row carries no such hint.
    const ok = await addHost(await startStub(), tokenEndingWith('okok'));
    await expect.poll(() => row(ok.id).count(), { timeout: SEEN_WITHIN_MS }).toBe(1);
    expect(await row(ok.id).locator('[data-testid="runner-host-token-rejected-hint"]').count()).toBe(0);
  });

  it('[ac:ac-status-w-karcie-zmienia-sie-bez-przel] the status in the card changes without reloading the page', async () => {
    const stub = await startStub();
    const host = await addHost(stub, tokenEndingWith('live'));
    expect(host.status).toBe('connected');
    await openWorkspaceSettings();
    await expect.poll(() => statusOf(host.id), { timeout: SEEN_WITHIN_MS }).toBe('Connected');

    // A marker that a reload would wipe, and a count of top-frame navigations.
    await page.evaluate(() => {
      (window as unknown as { __c4sNoReload?: boolean }).__c4sNoReload = true;
    });
    let navigations = 0;
    const onNav = (frame: { parentFrame(): unknown }) => {
      if (!frame.parentFrame()) navigations += 1;
    };
    page.on('framenavigated', onNav);
    try {
      // The runner shuts down and stays down: `closing` with `shutdown`, then 503s.
      stub.onHost = (_req, res) => {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'unavailable', message: 'down' }));
      };
      stub.onEvents = stub.onHost;
      stub.sendClosing('shutdown');

      await expect.poll(() => statusOf(host.id), { timeout: SEEN_WITHIN_MS }).toBe('Stopped');
      expect(await page.evaluate(() => (window as unknown as { __c4sNoReload?: boolean }).__c4sNoReload)).toBe(true);
      expect(navigations).toBe(0);
    } finally {
      page.off('framenavigated', onNav);
    }
  });
});
