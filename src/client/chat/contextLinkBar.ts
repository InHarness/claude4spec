import { hasBriefsCapability } from '../lib/capabilities.js';

/**
 * 2.1.77 (M44 `1j39ajh8`) — which artifact links the bar above the composer
 * shows for a thread. With the capability `briefs`: `Plan: …`, `Brief: …` or
 * `Patch: …` by context type and thread binding. Without it: only the `Plan: …`
 * link of a thread with a pinned plan — the `brief`/`patch` links are not
 * rendered whatever the thread row says.
 *
 * `capabilities` absent (config not read yet, or an older server) = every
 * capability, as in the sidebar's OTHERS filter.
 */
export type ContextLinkKind = 'plan' | 'brief' | 'patch';

export interface ContextLinkThread {
  contextType: string;
  planPath?: string | null;
  briefPath?: string | null;
  patchPath?: string | null;
}

export function contextLinkKinds(
  thread: ContextLinkThread | null | undefined,
  capabilities: readonly string[] | undefined,
): ContextLinkKind[] {
  if (!thread) return [];
  const hasBriefs = hasBriefsCapability(capabilities);
  const out: ContextLinkKind[] = [];
  // 0.2.87: never in an `ask` thread — that type has no artifact.
  if (thread.planPath != null && thread.contextType !== 'ask') out.push('plan');
  if (hasBriefs && thread.contextType === 'brief' && thread.briefPath) out.push('brief');
  if (hasBriefs && thread.contextType === 'patch' && thread.patchPath) out.push('patch');
  return out;
}
