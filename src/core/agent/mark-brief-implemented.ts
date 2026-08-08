import { AgentError, encodeArtifactPath, healthCheck, patchJson, resolveServer } from './http.js';

/**
 * `c4s mark-brief-implemented` (0.1.106 M11) — server-delegating, unlike its
 * filesystem-only `list-briefs`/`read-brief`/`file-patch` siblings: it wraps
 * `PATCH /api/artifacts/brief/:path/frontmatter` (M36 — was `/api/briefs/*`),
 * so it needs the identical resolve+health-check `c4s agent`/`c4s ask` use
 * (reused here, not reimplemented), then a single PATCH setting
 * `frontmatter: { implemented: true }`.
 */
export async function markBriefImplemented(params: {
  briefPath: string;
  project?: string;
  workspace?: string;
}): Promise<Record<string, unknown>> {
  const { baseUrl, apiBase } = await resolveServer({
    project: params.project,
    workspace: params.workspace,
  });
  await healthCheck(baseUrl, apiBase);

  // Same guard as `read-brief`, and for the same reason: `..` survives
  // `encodeURIComponent` and is collapsed by URL resolution, so a traversal
  // here would PATCH some other endpoint's frontmatter rather than being
  // refused. Pre-dates 0.2.13; closed with the shared helper rather than left
  // as the one call site that still hand-rolls the encoding.
  const encoded = encodeArtifactPath(params.briefPath);
  try {
    return await patchJson(`${apiBase}/artifacts/brief/${encoded}/frontmatter`, {
      frontmatter: { implemented: true },
    });
  } catch (err) {
    // The REST layer 404s as generic NOT_FOUND (`BriefService.getBrief`); this
    // command's entire domain is "one brief path", so surface the CLI's
    // brief-specific code instead of the generic one.
    if (err instanceof AgentError && err.code === 'NOT_FOUND') {
      throw new AgentError('BRIEF_NOT_FOUND', err.message, err.hint);
    }
    throw err;
  }
}
