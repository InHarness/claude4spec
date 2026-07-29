import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, Monitor } from 'lucide-react';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import { EntityViewSwitcher } from './EntityViewSwitcher.js';
import type { EntityType } from '../../../shared/entities.js';

interface Props {
  type: EntityType;
  slug: string;
  name?: string;
  view: 'details' | 'history';
  hasHistory?: boolean;
}

const crumbLinkClass = 'inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition';

export function EntityBreadcrumbBar({ type, slug, name, view, hasHistory }: Props) {
  const navigate = useNavigate();
  const mod = clientPluginHost.getAvailable(type);
  const listLabel = mod?.labelPlural ?? 'Entities';
  const prefix = mod?.pathPrefix ?? '';

  const crumb = renderCrumb(type, slug, name);

  return (
    <div
      className="flex items-center gap-2 px-5 py-2.5"
      style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
    >
      <div
        className="flex items-center gap-1.5 text-[12px] min-w-0"
        style={{ color: 'var(--c-muted)' }}
      >
        <button
          onClick={() => navigate({ to: prefix } as never)}
          className={crumbLinkClass}
          style={{ color: 'var(--c-muted)' }}
        >
          {listLabel}
        </button>
        <ChevronRight size={11} />
        <span
          className="flex items-center gap-1.5"
          style={{ color: 'var(--c-ink)', fontWeight: 600 }}
        >
          {crumb}
        </span>
      </div>
      <span className="flex-1" />
      {hasHistory && <EntityViewSwitcher type={type} slug={slug} view={view} />}
    </div>
  );
}

function renderCrumb(type: EntityType, slug: string, name?: string): React.ReactNode {
  // The `endpoint`, `dto` and `database-table` branches are gone: 0.2.2 moved
  // those three types out of the host, into the api-contracts envelope and the
  // database-tables plugin, and each ships its own breadcrumb. The branches here
  // survived the move as dead code — the host has no route that renders this bar
  // for any of them — and, being dead, kept the whole `entities/` tree exempt
  // from the Single Abstraction gate to no purpose.
  if (type === 'ui-view') {
    return (
      <>
        <Monitor size={12} style={{ color: 'var(--c-accent)' }} />
        <span>{name ?? slug}</span>
      </>
    );
  }
  return <span className="font-mono">{slug}</span>;
}
