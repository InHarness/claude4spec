import { describe, expect, it } from 'vitest';
import { changedByBadgeStyle, groupByRelease, type VersionHistoryItem } from './VersionHistory.js';

describe('changedByBadgeStyle (M13/M34)', () => {
  it('[ac:ac-badge-changedby-w-widoku-historii-ent] gives agent and user visually distinct colours', () => {
    const agent = changedByBadgeStyle('agent');
    const user = changedByBadgeStyle('user');

    // A shared colour would make the badge text the ONLY signal — the whole
    // point of the badge is that the difference reads at a glance.
    expect(agent.bg).not.toBe(user.bg);
    expect(agent.fg).not.toBe(user.fg);
  });

  it('falls back to a neutral colour for filesystem-authored versions', () => {
    const fs = changedByBadgeStyle('filesystem');
    expect(fs.bg).not.toBe(changedByBadgeStyle('agent').bg);
    expect(fs.bg).not.toBe(changedByBadgeStyle('user').bg);
  });
});


/**
 * 0.2.77 — the timeline stops being an axis of TIME and becomes an axis of
 * RELEASES.
 */
describe('groupByRelease (0.2.77)', () => {
  const v = (id: string, releaseLabel?: string): VersionHistoryItem => ({
    id,
    label: `v${id}`,
    createdAt: '2026-09-09',
    ...(releaseLabel ? { releaseLabel } : {}),
  });

  it('[ac:ac-timeline-wersji-encji-i-strony-grupuj] groups by release and pins the unreleased group to the top', () => {
    const groups = groupByRelease([
      v('5'),
      v('4'),
      v('3', 'v0.2'),
      v('2', 'v0.1'),
      v('1', 'v0.1'),
    ]);

    expect(groups.map((g) => g.label)).toEqual(['Unreleased', 'v0.2', 'v0.1']);
    // Unreleased is PULLED OUT, not left where it falls: `createRelease()` moves
    // the whole group in one step, and a group that could sit mid-axis would make
    // that move look like a reordering.
    expect(groups[0]!.unreleased).toBe(true);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['5', '4']);
    expect(groups[2]!.items.map((i) => i.id)).toEqual(['2', '1']);
  });

  it('omits the unreleased group entirely when every version belongs to a release', () => {
    const groups = groupByRelease([v('2', 'v0.1'), v('1', 'v0.1')]);
    // This is the state right after `createRelease()`: nothing is unreleased, so
    // there is no empty group left sitting at the top of the axis.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.unreleased).toBe(false);
  });

  it('2.1.20: the item has no releaseId — releaseLabel alone is the group heading', () => {
    // The published `VersionHistoryItem` dropped `releaseId`; the label both
    // heads the group and keys it, and an absent label means unreleased.
    const item = v('1', 'Release 7');
    expect('releaseId' in item).toBe(false);
    const groups = groupByRelease([item]);
    expect(groups[0]!.label).toBe('Release 7');
    expect(groups[0]!.unreleased).toBe(false);
  });

  it('keeps two runs of the same release apart only when they are actually apart', () => {
    // Rows arrive newest-first, so a release's versions are contiguous; grouping
    // walks in order rather than bucketing, which is what keeps the axis ordered
    // without assuming release ids are monotonic.
    const groups = groupByRelease([v('3', 'nine'), v('2', 'nine'), v('1', 'four')]);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1]);
  });
});
