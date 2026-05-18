import { FileText, History } from 'lucide-react';
import { usePageViewStore } from '../state/pageView.js';
import { ButtonGroup, SegmentButton } from './ButtonGroup.js';

export function PageViewSwitcher() {
  const pageView = usePageViewStore((s) => s.pageView);
  const setPageView = usePageViewStore((s) => s.setPageView);

  return (
    <ButtonGroup>
      <SegmentButton
        icon={<FileText size={12} />}
        label="Editor"
        active={pageView === 'editor'}
        onClick={() => setPageView('editor')}
        title="Show editor"
      />
      <SegmentButton
        icon={<History size={12} />}
        label="History"
        active={pageView === 'history'}
        onClick={() => setPageView('history')}
        title="Show version history"
      />
    </ButtonGroup>
  );
}
