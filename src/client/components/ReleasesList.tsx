import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, FileText, GitCommit, Plus } from 'lucide-react';
import { useReleases } from '../hooks/useReleases.js';
import { useAllReleasePushes } from '../hooks/useReleasePushes.js';
import { useBriefs } from '../hooks/useBriefs.js';
import type { BriefListItem } from '../../shared/entities.js';
import { UnreleasedBanner } from './release/UnreleasedBanner.js';
import { ImplementedBadge } from './BriefsList.js';

/** Briefs attached to a single release card — belonging (`toRelease === name`)
 * vs outgoing (an unreleased analysis brief authored FROM this release). */
interface ReleaseBriefs {
  belonging: BriefListItem[];
  outgoing: BriefListItem[];
}

interface Props {
  /** 0.1.122: "+ Create release" now lives in the shared ReleasesPage header
   * (visible on both tabs) — the empty-state CTA here just triggers it. */
  onCreateClick: () => void;
}

export function ReleasesList({ onCreateClick }: Props) {
  const { data: releases = [], isLoading } = useReleases();
  const { data: pushes = [] } = useAllReleasePushes();
  const { data: briefs = [] } = useBriefs();

  // Per-release count of SUCCESSFUL pushes (dedup hits count; errors do not).
  const pushedCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pushes) {
      if (p.status !== 'success') continue;
      m.set(p.releaseId, (m.get(p.releaseId) ?? 0) + 1);
    }
    return m;
  }, [pushes]);

  // 0.1.119 (M17): client-side join of releases + briefs by release NAME (the
  // brief frontmatter's from/toRelease are version strings, not release ids —
  // no slug on the release DTO to join on, and none needed). "Belonging" =
  // toRelease === this release's name (badge shows implemented/pending).
  // "Outgoing" = an unreleased analysis brief (toRelease === null) authored
  // FROM this release. Briefs with both null (degenerate) are dropped
  // entirely — they never render on any card, only on /briefs.
  const briefsByRelease = useMemo(() => {
    const m = new Map<string, ReleaseBriefs>();
    const bucket = (name: string): ReleaseBriefs => {
      let b = m.get(name);
      if (!b) {
        b = { belonging: [], outgoing: [] };
        m.set(name, b);
      }
      return b;
    };
    for (const b of briefs) {
      if (b.toRelease !== null) {
        bucket(b.toRelease).belonging.push(b);
      } else if (b.source === 'analysis' && b.fromRelease !== null) {
        bucket(b.fromRelease).outgoing.push(b);
      }
    }
    return m;
  }, [briefs]);

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 800, padding: '24px 32px 48px' }}>
        <UnreleasedBanner />
        {isLoading && (
          <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
            Loading…
          </div>
        )}
        {!isLoading && releases.length === 0 && (
          <div
            className="text-center py-20 rounded-lg"
            style={{
              background: 'var(--c-card)',
              border: '1px dashed var(--c-hair-strong)',
              color: 'var(--c-subtle)',
            }}
          >
            <div className="text-[14px]">No releases yet.</div>
            <div className="text-[12px] mt-1">
              Create one to snapshot the current spec state.
            </div>
            <button
              onClick={onCreateClick}
              className="mt-4 rounded-md flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] mx-auto"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              <Plus size={13} />
              Create release
            </button>
          </div>
        )}
        <div className="space-y-2">
          {releases.map((r) => (
            <Link
              key={r.id}
              to="/releases/$idOrName"
              params={{ idOrName: r.name }}
              className="flex items-start gap-3 px-4 py-3 rounded-md transition-colors"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
            >
              <GitCommit size={14} style={{ color: 'var(--c-accent)', marginTop: 3 }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold font-mono" style={{ color: 'var(--c-ink)' }}>
                    {r.name}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
                    by {r.createdBy} · {formatDate(r.createdAt)}
                  </span>
                  {pushedCounts.get(r.id) ? (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent-ink)' }}
                    >
                      {pushedCounts.get(r.id) === 1 ? 'Pushed' : `Pushed ${pushedCounts.get(r.id)}×`}
                    </span>
                  ) : null}
                </div>
                <div
                  className="text-[12.5px] mt-1"
                  style={{ color: 'var(--c-muted)' }}
                >
                  {r.description}
                </div>
                <ReleaseBriefsSection briefs={briefsByRelease.get(r.name)} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Briefs block on a release card — visually separate from the header/description
 * above it. Hidden entirely when the release has no belonging/outgoing briefs. */
function ReleaseBriefsSection({ briefs }: { briefs: ReleaseBriefs | undefined }) {
  if (!briefs || (briefs.belonging.length === 0 && briefs.outgoing.length === 0)) return null;
  return (
    <div className="mt-2 pt-2 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--c-hair)' }}>
      <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-subtle)' }}>
        Briefs
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {briefs.belonging.map((b) => (
          <BriefPill key={b.path} brief={b} />
        ))}
        {briefs.outgoing.map((b) => (
          <BriefPill key={b.path} brief={b} outgoing />
        ))}
      </div>
    </div>
  );
}

function BriefPill({ brief, outgoing }: { brief: BriefListItem; outgoing?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 min-w-0"
      style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
      title={outgoing ? `Outgoing analysis brief from this release: ${brief.path}` : brief.path}
    >
      <FileText size={11} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
      <span
        className="font-mono text-[11px] truncate"
        style={{ color: 'var(--c-ink)', maxWidth: 220 }}
      >
        {brief.path}
      </span>
      {outgoing ? (
        <ArrowUpRight size={11} style={{ color: 'var(--c-muted)', flexShrink: 0 }} aria-label="outgoing" />
      ) : null}
      <ImplementedBadge implemented={brief.implemented} />
    </span>
  );
}

function formatDate(iso: string): string {
  // Display-only formatting; preserve UTC ISO interpretation.
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString();
  } catch {
    return iso;
  }
}
