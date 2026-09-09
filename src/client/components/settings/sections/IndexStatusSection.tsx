import { ActionButton } from '../../../host-ui-kit/index.js';
import { useIndexStatus, useRebuildIndex } from '../../../hooks/useIndexStatus.js';
import { SettingsCard } from '../SettingsCard.js';
import type { ProjectionStatusRow } from '../../../../shared/projection-status.js';

/**
 * M26 §13 (0.2.77) — "Index status".
 *
 * The first named path to a manual reindex in the product. Until now a rebuild
 * was triggered de facto by saving settings with nothing changed, as a side
 * effect of context invalidation — a remedy you had to know a secret to reach.
 *
 * The card RENDERS ALWAYS, including when every projection is fresh. A card that
 * appears only on failure is indistinguishable from no card: nobody learns it
 * exists until the moment they most need it to already be familiar.
 *
 * Read-only apart from the one button. It edits neither the composition of a
 * projection nor `config.json`.
 */
export function IndexStatusSection() {
  const { data, isLoading } = useIndexStatus();
  const rebuild = useRebuildIndex();
  const rows = data?.projections ?? [];

  return (
    <SettingsCard
      id="index-status"
      title="Index status"
      description="The state of every projection in this project — fresh, stale or not built — with the time it was last recomputed."
    >
      <div className="flex flex-col gap-1.5">
        {isLoading && rows.length === 0 ? (
          <div className="text-[12.5px]" style={{ color: 'var(--c-ink-soft)' }}>
            Loading…
          </div>
        ) : (
          rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              busy={rebuild.isPending}
              onRebuild={() => rebuild.mutate(row.id)}
            />
          ))
        )}
      </div>
      <div className="flex items-center gap-3 pt-3 mt-2" style={{ borderTop: '1px solid var(--c-hair)' }}>
        <ActionButton
          label={rebuild.isPending ? 'Rebuilding…' : 'Rebuild all'}
          onClick={() => rebuild.mutate(undefined)}
          disabled={rebuild.isPending}
        />
        <span className="text-[11.5px]" style={{ color: 'var(--c-ink-soft)' }}>
          Rebuilding is safe at any time — it can be run on a projection that is already fresh.
        </span>
      </div>
    </SettingsCard>
  );
}

function Row({ row, busy, onRebuild }: { row: ProjectionStatusRow; busy: boolean; onRebuild: () => void }) {
  return (
    <div
      className="flex items-center gap-3 py-1.5"
      data-testid={`index-status-row-${row.id}`}
      data-state={row.state}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] truncate">{row.label}</div>
        <div className="text-[11px] truncate" style={{ color: 'var(--c-ink-soft)' }}>
          Last rebuilt: {formatWhen(row.lastRebuiltAt)}
        </div>
      </div>
      <StateBadge row={row} />
      <ActionButton label="Rebuild" onClick={onRebuild} disabled={busy} variant="ghost" />
    </div>
  );
}

/**
 * The three states are NOT a severity ladder and must not read as one.
 * `not_materialized` means nothing was ever built here; `stale` means something
 * was and no longer matches the files. They lead to different decisions, so they
 * get different words and different colours rather than shades of one.
 */
function StateBadge({ row }: { row: ProjectionStatusRow }) {
  const { text, color } = describe(row);
  return (
    <span
      className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
      style={{ color, border: `1px solid ${color}`, opacity: 0.9 }}
      title={row.refusesReads ? 'Reads from this projection are refused while it is stale.' : 'This projection keeps answering while stale — its records carry no write addresses.'}
    >
      {text}
    </span>
  );
}

function describe(row: ProjectionStatusRow): { text: string; color: string } {
  if (row.state === 'fresh') return { text: 'Fresh', color: 'var(--c-green, #4a7c59)' };
  if (row.state === 'not_materialized') return { text: 'Not built', color: 'var(--c-ink-soft)' };
  const scope =
    row.scope === 'global'
      ? 'all'
      : `${row.scope?.length ?? 0} item${(row.scope?.length ?? 0) === 1 ? '' : 's'}`;
  return { text: `Stale (${scope})`, color: 'var(--c-red, #c45a3b)' };
}

function formatWhen(at: number | null): string {
  if (at === null) return 'never';
  return new Date(at).toLocaleString();
}
