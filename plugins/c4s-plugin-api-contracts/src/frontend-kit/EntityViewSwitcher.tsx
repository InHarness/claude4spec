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
  const prefix = (clientPluginHost.getAvailable as (t: string) => { pathPrefix?: string } | null)(type)?.pathPrefix ?? '';

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
