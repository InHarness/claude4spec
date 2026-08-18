import { useNavigate } from '@tanstack/react-router';
import { Eye, FileText, History } from 'lucide-react';
import { SegmentedControl } from './SegmentedControl.js';
import { clientPluginHost } from '@c4s/plugin-runtime';
import type { EntityType } from '../types.js';

/**
 * The views a type can advertise in its topbar.
 *
 * `preview` joined in 0.2.28 for `ui-view`'s mockup document. It is a VIEW of
 * the entity, not a field of it — a screen mockup wants the pane, not a form
 * row — so it belongs on the same axis as details and history.
 */
export type EntityView = 'details' | 'preview' | 'history';

interface Props {
  type: EntityType;
  slug: string;
  view: EntityView;
  /**
   * Which views this type actually has ROUTES for, in the order they appear.
   *
   * Defaults to the app's basic pattern — details plus history — which every
   * other entity type already follows. A type only names this explicitly to
   * add to it.
   */
  views?: readonly EntityView[];
}

const OPTIONS: Record<EntityView, { label: string; icon: React.ReactNode; title: string }> = {
  details: { label: 'Details', icon: <FileText size={12} />, title: 'Show details' },
  preview: { label: 'Preview', icon: <Eye size={12} />, title: 'Show mockup preview' },
  history: { label: 'History', icon: <History size={12} />, title: 'Show version history' },
};

export const DEFAULT_VIEWS: readonly EntityView[] = ['details', 'history'];

export function EntityViewSwitcher({ type, slug, view, views = DEFAULT_VIEWS }: Props) {
  const navigate = useNavigate();
  // Method call — see the note in EntityBreadcrumbBar on why never a local.
  const prefix = clientPluginHost.getAvailable(type)?.pathPrefix ?? '';

  return (
    <SegmentedControl
      value={view}
      onChange={(next) =>
        navigate({
          // `details` is the bare detail route; every other view is a child
          // segment named after itself, which is what makes the active tab a
          // function of the URL rather than of any state held here.
          to: next === 'details' ? `${prefix}/$slug` : `${prefix}/$slug/${next}`,
          params: { slug },
        } as never)
      }
      options={views.map((v) => ({ value: v, ...OPTIONS[v] }))}
    />
  );
}
