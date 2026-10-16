import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

vi.mock('../lib/api-core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-core.js')>();
  return { ...actual, apiFetch: (input: string, init?: RequestInit) => apiFetch(input, init) };
});

const { fetchPlanList, orderPlansForPage } = await import('./usePlan.js');

function listResponse(rows: Array<{ path: string; title?: string; applied?: boolean; updatedAt: string | null }>): Response {
  return new Response(
    JSON.stringify({
      data: rows.map((r) => ({
        path: r.path,
        frontmatter: { type: 'plan', ...(r.title ? { title: r.title } : {}), ...(r.applied !== undefined ? { applied: r.applied } : {}) },
        hash: 'h',
        updatedAt: r.updatedAt,
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('/plans page list (M10 m10api00)', () => {
  beforeEach(() => apiFetch.mockReset());

  it('[section:m10api00] the /plans page list comes from the artifact family route GET /api/artifacts/:kind with :kind=plan, filters passed through as query', async () => {
    apiFetch.mockResolvedValue(listResponse([{ path: 'a.md', title: 'A', applied: true, updatedAt: '2026-10-01T00:00:00Z' }]));

    const all = await fetchPlanList();
    expect(apiFetch).toHaveBeenLastCalledWith('/api/artifacts/plan', undefined);
    expect(all).toEqual([{ path: 'a.md', title: 'A', applied: true, updatedAt: '2026-10-01T00:00:00Z' }]);

    await fetchPlanList({ applied: false, search: 'mig' });
    expect(apiFetch).toHaveBeenLastCalledWith('/api/artifacts/plan?search=mig&applied=false', undefined);
  });

  it('[section:m10api00] the page arranges the route\'s list_plans order (created_at ascending) as most recently changed first, undated rows last', async () => {
    // The route answers in the list_plans order: created_at ascending, ties by path.
    apiFetch.mockResolvedValue(
      listResponse([
        { path: 'oldest.md', updatedAt: '2026-10-05T00:00:00Z' },
        { path: 'undated.md', updatedAt: null },
        { path: 'middle.md', updatedAt: '2026-10-09T00:00:00Z' },
        { path: 'newest.md', updatedAt: '2026-10-02T00:00:00Z' },
      ]),
    );
    const rows = await fetchPlanList();
    expect(rows.map((r) => r.path)).toEqual(['middle.md', 'oldest.md', 'newest.md', 'undated.md']);
    // A plan without the `applied` key reads as not applied; a missing title as null.
    expect(rows[0]).toMatchObject({ applied: false, title: null });
  });

  it('orderPlansForPage keeps the server order between rows changed at the same time and does not mutate its input', () => {
    const input = [
      { path: 'b.md', title: null, applied: false, updatedAt: '2026-10-01T00:00:00Z' },
      { path: 'a.md', title: null, applied: false, updatedAt: '2026-10-01T00:00:00Z' },
    ];
    expect(orderPlansForPage(input).map((r) => r.path)).toEqual(['b.md', 'a.md']);
    expect(input.map((r) => r.path)).toEqual(['b.md', 'a.md']);
  });
});
