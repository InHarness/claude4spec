import { useState, type ReactNode } from 'react';
import { GitCommit, Plus } from 'lucide-react';
import { useUnreleasedCount } from '../hooks/useReleases.js';
import { useConfig } from '../hooks/useConfig.js';
import { useGitStatus } from '../hooks/useGitStatus.js';
import { SegmentedControlTabs } from '../host-ui-kit/detail/SegmentedControlTabs.js';
import { ReleasesList } from './ReleasesList.js';
import { ReleasesCompareTab } from './ReleasesCompareTab.js';
import { ReleasesShadowsTab } from './ReleasesShadowsTab.js';
import { CreateReleaseDialog } from './CreateReleaseDialog.js';

/** The screen's tabs — also the values of its `tab` param (ui-view `releases-list`). */
export const RELEASES_TABS = ['list', 'compare', 'shadow'] as const;
export type ReleasesTab = (typeof RELEASES_TABS)[number];

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
 * `/releases` shell (0.1.122 follow-up) — a single header shared by all tabs,
 * so "+ Create release" and the tab switcher stay put regardless of which view
 * is active.
 *
 * 2.1.46 (ui-view `releases-list`): three tabs — List, Compare and Shadows; the
 * Shadows tab exists only with git on and a detected repository. The screen's
 * params `tab` and `ref` (the route's search) say where a visit lands: the
 * header's Shadows section opens `?tab=shadow&ref=<id>`, `ref` presetting the
 * shadow. A click on a tab still only switches the tab — no navigation. Every
 * visit — a new history entry, `visit` being its key — is a request the screen
 * applies, even when its `tab` / `ref` equal the previous visit's: a repeated
 * click on the same header shadow after a tab switch or another pick lands on
 * that shadow again, and a visit without `tab` (e.g. browser Back from
 * `?tab=shadow&ref=<id>` to a plain `/releases`) lands on the list.
 *
 * A tab switch costs no request: every tab body stays mounted once shown and
 * the inactive one is only hidden, so their queries (release list, pushes,
 * briefs, the counter, the Compare diff, the shadow list and delta) are not
 * re-observed and refetched on every click — the WS invalidation map keeps
 * them fresh. Compare and Shadows are mounted on their first visit only, so a
 * /releases visit that never opens them does not pay for their diffs.
 */
export function ReleasesPage({
  tab: requestedTab,
  shadowRef,
  visit,
}: {
  tab?: ReleasesTab;
  shadowRef?: string;
  /** The history entry's key (`location.state.__TSR_key`): each visit is a new request. */
  visit?: string;
}) {
  const { data: unreleasedCount } = useUnreleasedCount();
  const { data: config } = useConfig();
  const gitOn = config?.git?.enabled === true;
  // Shared with the header's git entry: the same `["git-status"]` query.
  const { data: gitStatus } = useGitStatus({ enabled: gitOn });
  const shadowsAvailable = gitOn && gitStatus?.detected === true;

  const [tab, setTab] = useState<ReleasesTab>(requestedTab ?? 'list');
  const [shown, setShown] = useState<ReadonlySet<ReleasesTab>>(() => new Set([requestedTab ?? 'list']));
  const [seen, setSeen] = useState({ tab: requestedTab, ref: shadowRef, visit });
  if (seen.visit !== visit || seen.tab !== requestedTab || seen.ref !== shadowRef) {
    setSeen({ tab: requestedTab, ref: shadowRef, visit });
    // A visit without `tab` (browser Back to a plain `/releases`) lands on the list.
    select(requestedTab ?? 'list');
  }
  const [showCreate, setShowCreate] = useState(false);

  function select(id: ReleasesTab) {
    setTab(id);
    setShown((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  }

  // Without git the Shadows tab does not exist: a `?tab=shadow` visit lands on the list.
  const activeTab: ReleasesTab = tab === 'shadow' && !shadowsAvailable ? 'list' : tab;

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
            ...(shadowsAvailable ? [{ id: 'shadow', label: 'Shadows' }] : []),
          ]}
          active={activeTab}
          onChange={(id) => select(id as ReleasesTab)}
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

      <TabPanel id="list" active={activeTab === 'list'}>
        <ReleasesList onCreateClick={() => setShowCreate(true)} />
      </TabPanel>
      {shown.has('compare') && (
        <TabPanel id="compare" active={activeTab === 'compare'}>
          <ReleasesCompareTab />
        </TabPanel>
      )}
      {shadowsAvailable && shown.has('shadow') && (
        <TabPanel id="shadow" active={activeTab === 'shadow'}>
          <ReleasesShadowsTab requestedRef={shadowRef} visit={visit} />
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
