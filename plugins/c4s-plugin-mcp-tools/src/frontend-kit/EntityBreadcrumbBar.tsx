/**
 * The breadcrumb bar that sits ABOVE the detail panel, in the route wrapper.
 *
 * This is where the established generation of entity screens puts navigation:
 * `ac`, `dto`, `endpoint`, `ui-view` and `design-system` all render
 * `<EntityBreadcrumbBar/>` in their route component and leave the panel itself as
 * nothing but a form. Keeping it out of the panel is what makes the panel a
 * *body* — one `FieldGrid` of `FieldRow`s — rather than a screen that happens to
 * contain a form, and it is why Details and History share a frame without either
 * view owning it.
 *
 * WHY THIS IS A LOCAL COPY AND NOT THE VENDORED ONE. `api-contracts` and
 * `frontend-mockups` each vendor the host's bar verbatim, and both copies carry a
 * `renderCrumb` switch over `endpoint` / `dto` / `database-table` / `ui-view`.
 * Copying that here would import four other packages' type literals into this
 * one. The host's own copy went BRANCHLESS in 0.2.18 for exactly that reason: a
 * type that wants a display name distinct from its slug ships a bar that renders
 * it. This is that bar, for one type.
 *
 * The label and prefix come from `identity.ts` rather than
 * `clientPluginHost.getAvailable(type)`. One type means the lookup buys nothing,
 * and the lookup has a trap the vendored copies document: it reads `this.modules`,
 * so pulling it into a local silently unbinds the receiver and throws at render
 * while type-checking clean.
 */

import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { SegmentedControlTabs } from '@c4s/plugin-runtime/ui';
import { MCP_TOOL_LABEL_PLURAL, MCP_TOOL_PATH_PREFIX, MCP_TOOL_TYPE } from '../identity.js';
import { McpToolIcon } from '../entity/mcp-tool/frontend/icon.js';
import {
  navigateToEntity,
  navigateToEntityHistory,
  type Navigate,
} from '../entity/mcp-tool/frontend/navigation.js';

export type EntityView = 'details' | 'history';

interface Props {
  slug: string;
  /** The tool's wire name, when the record has loaded. Falls back to the slug. */
  name?: string;
  view: EntityView;
}

const crumbLinkClass = 'inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition';

export function EntityBreadcrumbBar({ slug, name, view }: Props) {
  const navigate = useNavigate() as Navigate;

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
          onClick={() => navigate({ to: MCP_TOOL_PATH_PREFIX })}
          className={crumbLinkClass}
          style={{ color: 'var(--c-muted)' }}
        >
          {MCP_TOOL_LABEL_PLURAL}
        </button>
        <ChevronRight size={11} />
        <span
          className="flex items-center gap-1.5"
          style={{ color: 'var(--c-ink)', fontWeight: 600 }}
        >
          <McpToolIcon size={12} style={{ color: 'var(--c-accent)' }} />
          <span className="font-mono">{name ?? slug}</span>
        </span>
      </div>
      <span className="flex-1" />
      <SegmentedControlTabs
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'history', label: 'History' },
        ]}
        active={view}
        onChange={(id) => {
          const next: EntityView = id === 'history' ? 'history' : 'details';
          if (next === view) return;
          if (next === 'history') navigateToEntityHistory(navigate, MCP_TOOL_TYPE, slug);
          else navigateToEntity(navigate, MCP_TOOL_TYPE, slug);
        }}
      />
    </div>
  );
}
