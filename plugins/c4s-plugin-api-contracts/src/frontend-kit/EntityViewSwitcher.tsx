/**
 * DEBT (2.1.19, Host UI Kit slice of `c4s-plugin-api-contracts`, endpoint + dto): the
 * detail view switcher fails the locality rule — one copy serves the endpoint
 * and dto detail views (condition 1), and the view switcher is common to every
 * entity type (condition 2). Its catalog replacement is `SegmentedControlTabs`.
 * Recorded, not fixed here.
 */
import { useNavigate } from '@tanstack/react-router';
import { FileText, History } from 'lucide-react';
import { SegmentedControl } from './SegmentedControl.js';
import { clientPluginHost } from '@c4s/plugin-runtime';
import type { EntityType } from '../types.js';

interface Props {
  type: EntityType;
  slug: string;
  view: 'details' | 'history';
}

export function EntityViewSwitcher({ type, slug, view }: Props) {
  const navigate = useNavigate();
  // Method call — see the note in EntityBreadcrumbBar on why never a local.
  const prefix = clientPluginHost.getAvailable(type)?.pathPrefix ?? '';

  return (
    <SegmentedControl
      value={view}
      onChange={(next) =>
        navigate({
          to: next === 'history' ? `${prefix}/$slug/history` : `${prefix}/$slug`,
          params: { slug },
        } as never)
      }
      options={[
        { value: 'details', label: 'Details', icon: <FileText size={12} />, title: 'Show details' },
        { value: 'history', label: 'History', icon: <History size={12} />, title: 'Show version history' },
      ]}
    />
  );
}
