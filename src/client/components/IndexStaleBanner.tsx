import { useNavigate } from '@tanstack/react-router';
import { hasGlobalStale, useIndexStatus, useRebuildIndex } from '../hooks/useIndexStatus.js';
import { useConfig } from '../hooks/useConfig.js';

/**
 * 2.1.77 (M26 `m26ui01` slot `Pas awarii`, L19 `e6k3f793`): the strip's one
 * sentence. With the capability `entities` it names search and entity lists;
 * without it the strip does not promise lists the project does not have.
 * `capabilities` absent (an older server) = the full sentence.
 */
export const FAILURE_STRIP_SENTENCE = 'Search and entity lists are unavailable — the index needs to be rebuilt.';
export const FAILURE_STRIP_SENTENCE_NO_ENTITIES = 'Search is unavailable — the index needs to be rebuilt.';
export function failureStripSentence(capabilities: readonly string[] | undefined): string {
  return !capabilities || capabilities.includes('entities') ? FAILURE_STRIP_SENTENCE : FAILURE_STRIP_SENTENCE_NO_ENTITIES;
}

/**
 * 0.2.77 — the full-width bar above the interface.
 *
 * THE ONLY RECORDED EXCEPTION to "nothing is rendered above the flex-row". The
 * rule now reads "nothing is rendered above the flex-row — with one, narrowly
 * drawn exception", and the exception is closed: it does not extend by analogy.
 * LOCAL staleness does not raise this bar (it gets the sidebar indicator and a
 * toast), and the old "Restart required" bar does not come back on its strength.
 * Widening it takes a change to the rule, not an appeal to it.
 *
 * What earns it: a GLOBAL marking is the state in which search, entity lists and
 * section writes all refuse. Without the warning the user meets a refusal on
 * their first click with no explanation. One sentence, one action.
 */
export function IndexStaleBanner() {
  const navigate = useNavigate();
  const { data } = useIndexStatus();
  const rebuild = useRebuildIndex();
  const { data: config } = useConfig();
  if (!hasGlobalStale(data?.projections)) return null;

  return (
    <div
      data-testid="index-stale-banner"
      className="w-full flex items-center gap-3 px-4 py-1.5 text-[12px] shrink-0"
      style={{
        background: 'var(--c-red, #c45a3b)',
        color: '#fff',
      }}
    >
      <span data-testid="index-stale-sentence" className="flex-1 min-w-0 truncate">
        {failureStripSentence(config?.capabilities)}
      </span>
      <button
        type="button"
        onClick={() => rebuild.mutate(undefined)}
        disabled={rebuild.isPending}
        className="px-2 py-0.5 rounded text-[11.5px] shrink-0"
        style={{ border: '1px solid rgba(255,255,255,0.7)', opacity: rebuild.isPending ? 0.6 : 1 }}
      >
        {rebuild.isPending ? 'Rebuilding…' : 'Rebuild index'}
      </button>
      <button
        type="button"
        onClick={() => navigate({ to: '/settings', hash: 'index-status' })}
        className="text-[11.5px] underline shrink-0"
      >
        Details
      </button>
    </div>
  );
}
