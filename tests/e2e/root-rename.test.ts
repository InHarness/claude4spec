import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * E2E: Settings → Directories, "Change root ID" (0.2.101).
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips, so `npm run test:e2e` is safe to run
 * anywhere.
 *
 * What Vitest cannot see, and this can: that the action RENDERS per row and
 * outside the shared Save, that a collision reaches the user at the target-id
 * field rather than as a silent no-op, and that after a rename the space is
 * served under its new address while the old one answers like any unknown root.
 *
 * Self-contained on purpose: it renames a USER root it creates itself. Renaming
 * the base root would be irreversible for the whole environment — the retired
 * `pages` can never be handed out again — and would break every other suite
 * sharing the env that navigates to `/space/pages/...`.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
}

interface Root {
  id: string;
  name: string;
  dir: string;
  builtin: boolean;
  [k: string]: unknown;
}

async function firstProject(): Promise<WorkspaceProject> {
  const res = await fetch(`${BASE}/api/workspace`);
  const body = (await res.json()) as { projects: WorkspaceProject[] };
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in the environment');
  return project;
}

async function readConfig(projectId: string): Promise<{ roots: Root[]; configHash: string }> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/config`);
  return (await res.json()) as { roots: Root[]; configHash: string };
}

async function patchConfig(projectId: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}/api/projects/${projectId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!BASE)('settings — Directories: Change root ID (0.2.101)', () => {
  let browser: Browser;
  let page: Page;
  let project: WorkspaceProject;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  // Unique per run: identifiers retired by a rename stay taken forever, so a
  // fixed name would collide with the previous run on a reused environment.
  const stamp = Date.now().toString(36);
  const fromId = `e2e-notes-${stamp}`;
  const toId = `e2e-journal-${stamp}`;

  beforeAll(async () => {
    browser = await chromium.launch();
    project = await firstProject();
    const onboarding = await patchConfig(project.id, { onboardingCompleted: true });
    if (!onboarding.ok) throw new Error(`failed to complete onboarding: ${onboarding.status}`);

    // A user root to rename, with one page in it so the new address has
    // something to render.
    const cfg = await readConfig(project.id);
    const base = cfg.roots.find((r) => r.builtin)!;
    const added = await patchConfig(project.id, {
      roots: [...cfg.roots, { ...base, id: fromId, name: 'E2E notes', dir: fromId, builtin: false }],
    });
    if (!added.ok) throw new Error(`failed to add a user root: ${added.status} ${await added.text()}`);
    // A just-added root is served by the NEXT context (the PATCH invalidated
    // the current one), so the create goes through the same route the app uses.
    const created = await fetch(`${BASE}/api/projects/${project.id}/pages/${fromId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'hello.md', content: '# Hello from a renamed space\n' }),
    });
    if (!created.ok) throw new Error(`failed to create a page: ${created.status} ${await created.text()}`);

    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // The one ≥400 this suite provokes on purpose is the refused rename in the
    // collision case. The browser reports it twice — as a response AND as a
    // "Failed to load resource" console error — so both listeners exempt exactly
    // that endpoint, by URL, and nothing else.
    const isRenameCall = (url: string | undefined): boolean =>
      !!url && /\/roots\/[^/]+\/rename$/.test(new URL(url).pathname);
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isRenameCall(msg.location().url)) consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && !isRenameCall(res.url())) {
        failedResponses.push(`${res.status()} ${res.url()}`);
      }
    });
    await page.goto(`${BASE}/p/${project.id}/settings`, { waitUntil: 'networkidle' });
  });

  afterAll(async () => {
    // Remove the user root this suite created (under whichever id it ended with).
    // Its directory stays on disk — removing a root never deletes files.
    if (project) {
      const cfg = await readConfig(project.id).catch(() => null);
      if (cfg) {
        await patchConfig(project.id, {
          roots: cfg.roots.filter((r) => r.id !== fromId && r.id !== toId),
        }).catch(() => {});
      }
    }
    await browser?.close();
  });

  const section = () => page.locator('#directories');
  const card = (id: string) => section().locator('div.rounded-md', { hasText: id }).first();

  it('[ac:m26-change-root-id-action] shows a per-row "Change root ID" action, apart from Save', async () => {
    await expect.poll(() => card(fromId).count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect
      .poll(() => card(fromId).getByRole('button', { name: 'Change root ID' }).count())
      .toBeGreaterThan(0);
    // The base root offers it too — the operation has no base-root variant.
    const base = (await readConfig(project.id)).roots.find((r) => r.builtin)!;
    await expect
      .poll(() => card(base.id).getByRole('button', { name: 'Change root ID' }).count())
      .toBeGreaterThan(0);
  });

  it('[ac:m26-change-root-id-collision] a taken id is refused AT the target-id field, and nothing changes', async () => {
    const base = (await readConfig(project.id)).roots.find((r) => r.builtin)!;
    await card(fromId).getByRole('button', { name: 'Change root ID' }).click();
    const input = card(fromId).locator('input[placeholder="kebab-case slug"]');
    await input.fill(base.id);
    await card(fromId).getByRole('button', { name: 'Change', exact: true }).click();
    await expect
      .poll(() => card(fromId).getByText(/already used/i).count(), { timeout: 5_000 })
      .toBeGreaterThan(0);
    expect((await readConfig(project.id)).roots.map((r) => r.id)).toContain(fromId);
  });

  it('[ac:m26-change-root-id-renames] renames the space and serves its pages under the new address', async () => {
    const input = card(fromId).locator('input[placeholder="kebab-case slug"]');
    await input.fill(toId);
    await card(fromId).getByRole('button', { name: 'Change', exact: true }).click();

    await expect
      .poll(async () => (await readConfig(project.id)).roots.map((r) => r.id), { timeout: 10_000 })
      .toContain(toId);
    const after = await readConfig(project.id);
    expect(after.roots.map((r) => r.id)).not.toContain(fromId);
    // Identity and location are independent: the directory did not move.
    expect(after.roots.find((r) => r.id === toId)!.dir).toBe(fromId);

    // The page renders under the new segment — asserted on rendered content, not
    // the URL, since a blank SPA shell also returns 200.
    await page.goto(`${BASE}/p/${project.id}/space/${toId}/hello.md`, { waitUntil: 'networkidle' });
    await expect
      .poll(() => page.getByText('Hello from a renamed space').count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  it('[ac:m26-change-root-id-old-address] the retired address answers like an unknown root, not an alias', async () => {
    const res = await fetch(`${BASE}/api/projects/${project.id}/pages/${fromId}/get?path=hello.md`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const ok = await fetch(`${BASE}/api/projects/${project.id}/pages/${toId}/get?path=hello.md`);
    expect(ok.status).toBe(200);
  });

  it('logged no console errors and no unexpected failed responses along the way', () => {
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
