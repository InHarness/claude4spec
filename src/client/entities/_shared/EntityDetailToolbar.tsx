import { useNavigate } from '@tanstack/react-router';
import { Braces, ChevronRight, Database, Monitor } from 'lucide-react';
import { MethodBadge } from '../../components/atoms.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import { EntityViewSwitcher } from './EntityViewSwitcher.js';
import type { EntityType, HttpMethod } from '../../../shared/entities.js';

interface Props {
  type: EntityType;
  slug: string;
  method?: HttpMethod;
  path?: string;
  name?: string;
  view: 'details' | 'history';
  hasHistory?: boolean;
}

const crumbLinkClass = 'inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition';

export function EntityDetailToolbar({ type, slug, method, path, name, view, hasHistory }: Props) {
  const navigate = useNavigate();
  const mod = clientPluginHost.getAvailable(type);
  const listLabel = mod?.labelPlural ?? 'Entities';
  const prefix = mod?.pathPrefix ?? '';

  const crumb = renderCrumb(type, slug, method, path, name);

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

function renderCrumb(
  type: EntityType,
  slug: string,
  method?: HttpMethod,
  path?: string,
  name?: string,
): React.ReactNode {
  if (type === 'endpoint') {
    return (
      <>
        {method && <MethodBadge method={method} />}
        {path && <span className="font-mono">{path}</span>}
      </>
    );
  }
  if (type === 'dto') {
    return (
      <>
        <Braces size={12} style={{ color: 'var(--c-accent)' }} />
        <span>{name ?? slug}</span>
      </>
    );
  }
  if (type === 'database-table') {
    return (
      <>
        <Database size={12} style={{ color: 'var(--c-accent)' }} />
        <span className="font-mono">{name ?? slug}</span>
      </>
    );
  }
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
