import { AgentError, healthCheck, patchJson, resolveServer } from './run-agent.js';

/**
 * `c4s mark-brief-implemented` (0.1.106 M11) — server-delegating, unlike its
 * filesystem-only `list-briefs`/`read-brief`/`file-patch` siblings: it wraps
 * `PATCH /api/briefs/:path/frontmatter`, so it needs the identical
 * resolve+health-check `c4s agent`/`c4s ask` use (reused here, not
 * reimplemented), then a single PATCH setting `implemented: true`.
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

  const encoded = params.briefPath.split('/').map(encodeURIComponent).join('/');
  try {
    return await patchJson(`${apiBase}/briefs/${encoded}/frontmatter`, { implemented: true });
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
