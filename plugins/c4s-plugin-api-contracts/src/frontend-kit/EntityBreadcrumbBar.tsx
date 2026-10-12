/**
 * DEBT (2.1.19, Host UI Kit slice of `c4s-plugin-api-contracts`, endpoint + dto): the
 * detail breadcrumb bar fails the locality rule — one copy serves the endpoint
 * and dto details (condition 1), and the detail breadcrumb bar is common to
 * every entity type, each of four plugin packages keeping its own version
 * (condition 2). Its catalog replacement is `DetailPanelShell`.
 * Recorded, not fixed here; the `/endpoints/$slug` and `/dtos/$slug` routes
 * still render through it.
 */
import { useNavigate } from '@tanstack/react-router';
import { Braces, ChevronRight, Database, Monitor } from 'lucide-react';
import { MethodChip } from './atoms.js';
import { clientPluginHost } from '@c4s/plugin-runtime';
import { EntityViewSwitcher } from './EntityViewSwitcher.js';
import type { EntityType, HttpMethod } from '../types.js';

interface Props {
  type: EntityType;
  slug: string;
  method?: HttpMethod;
  path?: string;
  name?: string;
  view: 'details' | 'history';
  hasHistory?: boolean;
  /**
   * View-specific controls, rendered to the left of the view switcher. An
   * opaque node: the route that owns the view decides what it does — the `dto`
   * detail route passes its Delete button here (2.1.16, M13 detail pattern).
   */
  actions?: React.ReactNode;
}

const crumbLinkClass = 'inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition';

export function EntityBreadcrumbBar({ type, slug, method, path, name, view, hasHistory, actions }: Props) {
  const navigate = useNavigate();
  // Always a METHOD call. `getAvailable` reads `this.modules`, so pulling it
  // into a local — the obvious way to write a cast once — silently unbinds the
  // receiver and throws "Cannot read properties of undefined" at render. It
  // type-checks either way; only the browser tells you.
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
      {actions}
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
        {method && <MethodChip method={method} />}
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
