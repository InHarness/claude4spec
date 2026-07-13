import { useState } from 'react';
import { GitCommit, Plus } from 'lucide-react';
import { useUnreleasedCount } from '../hooks/useReleases.js';
import { SegmentedControlTabs } from '../host-ui-kit/detail/SegmentedControlTabs.js';
import { ReleasesList } from './ReleasesList.js';
import { ReleasesCompareTab } from './ReleasesCompareTab.js';
import { CreateReleaseDialog } from './CreateReleaseDialog.js';

export type ReleasesTab = 'list' | 'compare';

interface Props {
  tab: ReleasesTab;
  onTabChange: (tab: ReleasesTab) => void;
}

/**
 * `/releases` shell (0.1.122 follow-up) — a single header shared by both
 * tabs, so "+ Create release" and the tab switcher stay put regardless of
 * which view is active (previously "+ Create release" lived inside
 * `ReleasesList`'s own header and disappeared on the Compare tab).
 */
export function ReleasesPage({ tab, onTabChange }: Props) {
  const { data: unreleasedCount = 0 } = useUnreleasedCount();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <GitCommit size={18} style={{ color: 'var(--c-accent)' }} />
        <SegmentedControlTabs
          tabs={[
            { id: 'list', label: 'Releases' },
            { id: 'compare', label: `Changes (${unreleasedCount})` },
          ]}
          active={tab}
          onChange={(id) => onTabChange(id as ReleasesTab)}
        />
        <span className="flex-1" />
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md flex items-center gap-1.5 px-2.5 py-1 text-[12.5px]"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Plus size={13} />
          Create release
        </button>
      </div>

      {tab === 'compare' ? (
        <ReleasesCompareTab />
      ) : (
        <ReleasesList onCreateClick={() => setShowCreate(true)} />
      )}

      {showCreate && <CreateReleaseDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}
