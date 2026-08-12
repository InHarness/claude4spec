import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
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
  /*
   * 0.2.18: BRANCHLESS, and that is the point.
   *
   * The `endpoint`, `dto` and `database-table` branches went in 0.2.2/0.2.11
   * when those types moved out of the host; `ui-view` was the last one left, and
   * it goes here with `ui-view` and `design-system` into the
   * `c4s-plugin-frontend-mockups` envelope. Each extracted package renders its
   * own crumb — api-contracts and frontend-mockups by vendoring this component,
   * database-tables through `DetailPanelShell` — so the Single Abstraction gate
   * now expects ZERO `type === '<literal>'` hits in the host, with no exemption.
   *
   * `name` is still taken, and still ignored here: the host cannot know which
   * types have a display name distinct from the slug. A type that wants one
   * ships a bar that uses it.
   */
  return <span className="font-mono">{slug}</span>;
}
