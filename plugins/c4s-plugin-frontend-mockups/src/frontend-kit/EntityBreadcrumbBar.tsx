/**
 * The host's `EntityBreadcrumbBar`, vendored.
 *
 * A plugin cannot import from the host's `src/`, and `FrontendModule` has no
 * slot for a per-type crumb — no `icon`, no `renderBreadcrumb` — so the type
 * cannot supply one through the manifest either. Every extracted package
 * therefore owns its own bar: `c4s-plugin-api-contracts` vendored this file,
 * `c4s-plugin-database-tables` renders its crumb inline through
 * `DetailPanelShell`. This copy is trimmed to the two types this envelope
 * contributes; the `endpoint`/`dto`/`database-table` branches belong to their
 * own packages.
 *
 * The type literals below are legal HERE and only here: `plugins/<name>/src/`
 * is where a type is allowed to know its own name. The host's copy is now
 * branchless.
 */

import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, Monitor, Palette } from 'lucide-react';
import { clientPluginHost } from '@c4s/plugin-runtime';
import { EntityViewSwitcher, type EntityView } from './EntityViewSwitcher.js';
import { DESIGN_SYSTEM_TYPE, UI_VIEW_TYPE } from '../identity.js';
import type { EntityType } from '../types.js';

interface Props {
  type: EntityType;
  slug: string;
  name?: string;
  view: EntityView;
  /**
   * Which views this type has routes for — `undefined` means the default pair
   * (details + history).
   *
   * It replaced a `hasHistory` boolean in 0.2.28. The boolean was only ever a
   * way to HIDE a switcher for the two types in this envelope that had no
   * second route; once both grew one, the question stopped being "is there
   * history" and became "which views exist", which is the thing the switcher
   * needs anyway.
   */
  views?: readonly EntityView[];
}

const crumbLinkClass = 'inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition';

export function EntityBreadcrumbBar({ type, slug, name, view, views }: Props) {
  const navigate = useNavigate();
  // Always a METHOD call. `getAvailable` reads `this.modules`, so pulling it
  // into a local — the obvious way to write a cast once — silently unbinds the
  // receiver and throws "Cannot read properties of undefined" at render. It
  // type-checks either way; only the browser tells you.
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
      {(views?.length ?? 2) > 1 && (
        <EntityViewSwitcher type={type} slug={slug} view={view} views={views} />
      )}
    </div>
  );
}

function renderCrumb(type: EntityType, slug: string, name?: string): React.ReactNode {
  if (type === UI_VIEW_TYPE) {
    return (
      <>
        <Monitor size={12} style={{ color: 'var(--c-accent)' }} />
        <span>{name ?? slug}</span>
      </>
    );
  }
  if (type === DESIGN_SYSTEM_TYPE) {
    return (
      <>
        <Palette size={12} style={{ color: 'var(--c-accent)' }} />
        <span>{name ?? slug}</span>
      </>
    );
  }
  return <span className="font-mono">{slug}</span>;
}
