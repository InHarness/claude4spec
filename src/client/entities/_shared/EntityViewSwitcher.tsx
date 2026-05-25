import { useNavigate } from '@tanstack/react-router';
import { FileText, History } from 'lucide-react';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import type { EntityType } from '../../../shared/entities.js';

interface Props {
  type: EntityType;
  slug: string;
  view: 'details' | 'history';
}

export function EntityViewSwitcher({ type, slug, view }: Props) {
  const navigate = useNavigate();
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
