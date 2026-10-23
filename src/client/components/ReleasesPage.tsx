import { useState, type ReactNode } from 'react';
import { GitCommit, Plus } from 'lucide-react';
import { useUnreleasedCount } from '../hooks/useReleases.js';
import { SegmentedControlTabs } from '../host-ui-kit/detail/SegmentedControlTabs.js';
import { ReleasesList } from './ReleasesList.js';
import { ReleasesCompareTab } from './ReleasesCompareTab.js';
import { CreateReleaseDialog } from './CreateReleaseDialog.js';

type ReleasesTab = 'list' | 'compare';

/**
 * 2.1.45 (M17 `releases-list`) — the Compare tab's label: „Changes (N)”, N being
 * the unreleased counter (M17 L2 zbc9jdnr, the shared `useUnreleasedCount`
 * query). At N = 0, and without any release (the counter does not exist, so
 * `count` is `undefined`), the label is plain „Changes”.
 */
function compareTabLabel(count: number | undefined): string {
  return count != null && count > 0 ? `Changes (${count})` : 'Changes';
}

/**
 * `/releases` shell (0.1.122 follow-up) — a single header shared by both
 * tabs, so "+ Create release" and the tab switcher stay put regardless of
 * which view is active.
 *
 * 2.1.45: the active tab is screen state, not URL state — the view has no
 * params, and the Compare deep link (`?tab=compare`, preset latest → current)
 * is gone. A click on „Changes (N)” only switches the tab.
 *
 * A tab switch costs no request: both tab bodies stay mounted once shown and
 * the inactive one is only hidden, so their queries (release list, pushes,
 * briefs, the counter, the Compare diff) are not re-observed and refetched on
 * every click — the WS invalidation map keeps them fresh. The Compare body is
 * mounted on its first visit only, so a /releases visit that never opens it
 * does not pay for the full diff.
 */
export function ReleasesPage() {
  const { data: unreleasedCount } = useUnreleasedCount();
  const [tab, setTab] = useState<ReleasesTab>('list');
  const [compareShown, setCompareShown] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <GitCommit size={18} style={{ color: 'var(--c-accent)' }} />
        <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
          Releases
        </h2>
        <span className="flex-1" />
        <SegmentedControlTabs
          tabs={[
            { id: 'list', label: 'Releases' },
            { id: 'compare', label: compareTabLabel(unreleasedCount) },
          ]}
          active={tab}
          onChange={(id) => {
            setTab(id as ReleasesTab);
            if (id === 'compare') setCompareShown(true);
          }}
        />
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md flex items-center gap-1.5 px-2.5 py-1 text-[12.5px]"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Plus size={13} />
          Create release
        </button>
      </div>

      <TabPanel id="list" active={tab === 'list'}>
        <ReleasesList onCreateClick={() => setShowCreate(true)} />
      </TabPanel>
      {compareShown && (
        <TabPanel id="compare" active={tab === 'compare'}>
          <ReleasesCompareTab />
        </TabPanel>
      )}

      {showCreate && <CreateReleaseDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

/** A tab body that stays mounted while inactive — hidden, not unmounted. */
function TabPanel({ id, active, children }: { id: ReleasesTab; active: boolean; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      data-tab-panel={id}
      hidden={!active}
      className={active ? 'flex-1 flex flex-col min-h-0' : 'hidden'}
    >
      {children}
    </div>
  );
}
