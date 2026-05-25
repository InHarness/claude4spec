import { FileText, History } from 'lucide-react';
import { usePageViewStore } from '../state/pageView.js';
import { SegmentedControl } from './SegmentedControl.js';

export function PageViewSwitcher() {
  const pageView = usePageViewStore((s) => s.pageView);
  const setPageView = usePageViewStore((s) => s.setPageView);

  return (
    <SegmentedControl
      value={pageView}
      onChange={setPageView}
      options={[
        { value: 'editor', label: 'Editor', icon: <FileText size={12} />, title: 'Show editor' },
        { value: 'history', label: 'History', icon: <History size={12} />, title: 'Show version history' },
      ]}
    />
  );
}
