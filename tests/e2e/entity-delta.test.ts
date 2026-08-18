import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * E2E: the host-generated entity delta (0.2.31).
 *
 * The unit tests next to `schema-diff.ts` pin the engine against synthetic
 * schemas. What they cannot see is the round trip: a real write capturing a real
 * version, the route upgrading and pairing two captures, the wire shape that
 * comes back, and the card that renders it. A `curl` on the release page returns
 * 200 for a white SPA shell, and it cannot tell whether the delta rendered one
 * bullet per operation or nothing at all.
 *
 * `dto` is the subject because it is the type whose declaration exercises the
 * most of the dictionary at once: `fields` and `examples` both carry an
 * `identity: ['name']`, and `examples[].value` is a free-JSON node, so one
 * entity produces `item_modified`, `item_added`, a nested `field_changed` and a
 * `field_changed_opaque` without any contrivance.
 *
 * Runs against a LIVE app — normally an env-runner environment built from the
 * branch under test (`c4s-env-runner` skill) — pointed at by `C4S_E2E_BASE_URL`.
 * Without that variable every case skips.
 */
const BASE = process.env.C4S_E2E_BASE_URL?.replace(/\/$/, '');

interface WorkspaceProject {
  id: string;
  name: string;
}

interface DiffOp {
  op: string;
  path?: string;
  identity?: Record<string, unknown>;
  changes?: DiffOp[];
  from?: unknown;
  to?: unknown;
  fromBytes?: number;
  toBytes?: number;
  item?: unknown;
  tag?: string;
}

interface WireDelta {
  type: string;
  slug: string;
  op: string;
  changes: DiffOp[];
  raw?: unknown;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}

async function firstProject(): Promise<WorkspaceProject> {
  const { body } = await api<{ projects: WorkspaceProject[] }>('/api/workspace');
  const project = body.projects[0];
  if (!project) throw new Error('no project registered in this environment');
  await api(`/api/projects/${project.id}/config`, {
    method: 'PATCH',
    body: JSON.stringify({ onboardingCompleted: true }),
  });
  return project;
}

/** The two most recent version numbers, newest first. */
async function versions(projectId: string, slug: string): Promise<number[]> {
  const { body } = await api<{ versions: Array<{ version: number }> }>(
    `/api/projects/${projectId}/entities/dto/${slug}/versions`,
  );
  return (body.versions ?? []).map((v) => v.version);
}

/** The delta between the two most recent captures. */
async function latestDelta(projectId: string, slug: string): Promise<WireDelta> {
  const [newer, older] = await versions(projectId, slug);
  const { body } = await api<WireDelta>(
    `/api/projects/${projectId}/entities/dto/${slug}/versions/${older}/diff/${newer}`,
  );
  return body;
}

describe.skipIf(!BASE)('the host-generated entity delta', () => {
  let project: WorkspaceProject;
  let slug: string;

  beforeAll(async () => {
    project = await firstProject();
    const { body } = await api<{ data: { slug: string } }>(`/api/projects/${project.id}/dtos`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Delta Probe ${Date.now()}`,
        description: 'v1',
        fields: [
          { name: 'id', type: 'string', required: true, description: 'the id' },
          { name: 'email', type: 'string', required: false, description: 'the email' },
        ],
        examples: [{ name: 'basic', summary: 'a basic one', value: { id: 'x' } }],
      }),
    });
    slug = body.data.slug;
  });

  afterAll(async () => {
    if (slug) await api(`/api/projects/${project.id}/dtos/${slug}`, { method: 'DELETE' });
  });

  it('answers with the closed envelope — `updated`, a `changes` ARRAY, and no `raw`', async () => {
    await api(`/api/projects/${project.id}/dtos/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'v2' }),
    });
    const delta = await latestDelta(project.id, slug);

    // `updated`, not `modified`: the entity vocabulary matches the EntityDiff
    // envelope. Pages keep `modified` — that is M02's FileDiff, a different layer.
    expect(delta.op).toBe('updated');
    expect(Array.isArray(delta.changes)).toBe(true);
    // The deep-diff mode is gone, and with it the field that carried its output.
    expect(delta).not.toHaveProperty('raw');
    expect(delta.changes).toContainEqual({
      op: 'field_changed',
      path: 'description',
      from: 'v1',
      to: 'v2',
    });
  });

  /**
   * The single most valuable case here, and the reason `identity` exists at all.
   * Without it both sides would be matched positionally or by deep equality, and
   * editing one attribute of one field would read as "one field vanished, an
   * unrelated one arrived" — technically true of the JSON, useless to a reader.
   */
  it('reports an edit to a collection item as item_modified, not as a remove/add pair', async () => {
    await api(`/api/projects/${project.id}/dtos/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: [
          { name: 'id', type: 'string', required: true, description: 'the id' },
          { name: 'email', type: 'string', required: true, description: 'the email' },
        ],
      }),
    });
    const delta = await latestDelta(project.id, slug);

    expect(delta.changes.map((c) => c.op)).not.toContain('item_removed');
    expect(delta.changes.map((c) => c.op)).not.toContain('item_added');
    expect(delta.changes).toContainEqual({
      op: 'item_modified',
      path: 'fields',
      identity: { name: 'email' },
      // A LIST of operations, never a count — the nested level uses the same
      // eight-op grammar, recursively.
      changes: [{ op: 'field_changed', path: 'fields[].required', from: false, to: true }],
    });
  });

  it('treats a pure reshuffle of an identified collection as no change to it', async () => {
    const before = await versions(project.id, slug);
    await api(`/api/projects/${project.id}/dtos/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: [
          { name: 'email', type: 'string', required: true, description: 'the email' },
          { name: 'id', type: 'string', required: true, description: 'the id' },
        ],
      }),
    });
    const after = await versions(project.id, slug);
    // Either the write captured nothing, or it captured a version whose delta
    // carries no operation on `fields`. Both are the same statement.
    if (after.length === before.length) return;
    const delta = await latestDelta(project.id, slug);
    expect(delta.changes.filter((c) => c.path === 'fields')).toEqual([]);
  });

  it('reports a free-JSON field by SIZE, never by value', async () => {
    await api(`/api/projects/${project.id}/dtos/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify({
        examples: [
          { name: 'basic', summary: 'a basic one', value: { id: 'x', extra: 'A-DISTINCTIVE-BLOB' } },
        ],
      }),
    });
    const delta = await latestDelta(project.id, slug);
    const nested = delta.changes.find((c) => c.op === 'item_modified' && c.path === 'examples');

    expect(nested?.changes?.[0]?.op).toBe('field_changed_opaque');
    expect(nested?.changes?.[0]?.path).toBe('examples[].value');
    // The whole point of the opaque class: the value never rides along.
    expect(JSON.stringify(delta)).not.toContain('A-DISTINCTIVE-BLOB');
  });

  /**
   * The declaration is a CLAIM about the data, and nothing enforces it.
   * `endpoint.linkedDtos` keys on `dto` + `relation` while its join table also
   * discriminates on `statusCode` — so two links to the same DTO with different
   * response codes share one identity, legitimately. Pairing the first of each
   * side reported an arrival as an edit of its neighbour: exactly the failure
   * mode the engine's own docstring warns about ("a wrong identity does not
   * fail, it lies"), reachable from a declaration that looks correct.
   *
   * This runs through the real API rather than a synthetic schema on purpose:
   * the point is that a SHIPPED declaration has this shape.
   */
  it('reports an arrival under a contested identity as item_added, not as an edit', async () => {
    const stamp = Date.now();
    const { body: dto } = await api<{ data: { slug: string } }>(`/api/projects/${project.id}/dtos`, {
      method: 'POST',
      body: JSON.stringify({ title: `Contested ${stamp}`, description: 'e' }),
    });
    const link = (statusCode: number) => ({ dto: dto.data.slug, relation: 'response', statusCode });
    const { body: ep } = await api<{ data: { slug: string } }>(
      `/api/projects/${project.id}/endpoints`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: `Contested Probe ${stamp}`,
          method: 'GET',
          path: `/contested-${stamp}`,
          linkedDtos: [link(404)],
        }),
      },
    );
    const ep_slug = ep.data.slug;

    try {
      const deltaAfter = async (): Promise<DiffOp[]> => {
        const { body } = await api<{ versions: Array<{ version: number }> }>(
          `/api/projects/${project.id}/entities/endpoint/${ep_slug}/versions`,
        );
        const [newer, older] = (body.versions ?? []).map((v) => v.version);
        const { body: d } = await api<WireDelta>(
          `/api/projects/${project.id}/entities/endpoint/${ep_slug}/versions/${older}/diff/${newer}`,
        );
        return d.changes;
      };

      await api(`/api/projects/${project.id}/endpoints/${ep_slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ linkedDtos: [link(404), link(500)] }),
      });
      const added = await deltaAfter();
      expect(added.map((c) => c.op)).toContain('item_added');
      // The 404 link did not move, so it says nothing at all — a contested key
      // degrades to add/remove, it does not restate the whole collection.
      expect(added.map((c) => c.op)).not.toContain('item_modified');
      expect(added).toHaveLength(1);

      await api(`/api/projects/${project.id}/endpoints/${ep_slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ linkedDtos: [link(404)] }),
      });
      const removed = await deltaAfter();
      expect(removed.map((c) => c.op)).toContain('item_removed');
      expect(removed.map((c) => c.op)).not.toContain('item_modified');
    } finally {
      await api(`/api/projects/${project.id}/endpoints/${ep_slug}`, { method: 'DELETE' });
      await api(`/api/projects/${project.id}/dtos/${dto.data.slug}`, { method: 'DELETE' });
    }
  });

  /**
   * The card, in a real browser. Three of the eight operations carry content and
   * get an expand affordance; the other five say everything inline. This checks
   * the pair that matters — an inline `field_changed` beside an expandable
   * `item_modified` whose nested list is the same grammar one level down.
   */
  it('renders one row per operation on the release page, with a clean console', async () => {
    const browser: Browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });

    try {
      const stamp = Date.now();
      const { body: baseline } = await api<{ id: number; name: string }>(
        `/api/projects/${project.id}/releases`,
        {
          method: 'POST',
          body: JSON.stringify({ name: `delta-probe-a-${stamp}`, description: 'baseline' }),
        },
      );
      await api(`/api/projects/${project.id}/dtos/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify({
          description: 'after the baseline',
          fields: [
            { name: 'id', type: 'string', required: true, description: 'the id' },
            { name: 'email', type: 'string', required: true, description: 'the email, edited' },
            { name: 'nickname', type: 'string', required: false, description: 'a new one' },
          ],
        }),
      });
      const { body: head } = await api<{ id: number }>(`/api/projects/${project.id}/releases`, {
        method: 'POST',
        body: JSON.stringify({ name: `delta-probe-b-${stamp}`, description: 'after the edit' }),
      });

      await page.goto(`${BASE}/p/${project.id}/releases/${head.id}`, { waitUntil: 'networkidle' });

      /**
       * The page opens against "initial state", where every entity is `created`
       * and carries no operations BY DESIGN — the full state comes from the
       * snapshot, not from a per-field list. Point it at the baseline release so
       * the dictionary has something to say.
       */
      await page.locator('select').first().selectOption({ label: baseline.name });
      await expect.poll(() => page.getByText(slug).first().isVisible()).toBe(true);

      const text = await page.locator('body').innerText();
      // An inline field_changed, with its from → to on the row itself.
      expect(text).toContain('description');
      // An expandable item_modified and an expandable item_added, labelled by
      // the identity tuple rather than by an index.
      expect(text).toContain('fields[email]');
      expect(text).toContain('fields[nickname]');

      // The nested list appears only once the row is expanded.
      expect(text).not.toContain('fields[].description');
      await page.getByRole('button', { name: 'fields[email]' }).first().click();
      await expect
        .poll(() => page.getByText('fields[].description').first().isVisible())
        .toBe(true);

      expect(consoleErrors).toEqual([]);
      expect(badResponses).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
