import { designSystemData, designSystemSlugPattern } from '../schema.js';
import { ChevronRight, Palette } from 'lucide-react';
import type { DesignSystem, ResolvedTokenValue } from '../../../types.js';
import { resolve } from '../../../design-system-domain.js';
import { useDesignSystem } from './hooks.js';
import { designSystemsApi, countsOf } from './api.js';
import type {
  EntityCardProps,
  EntityChipProps,
  EntityRowProps,
  FrontendModule,
} from '@c4s/plugin-runtime';
import {
  DESIGN_SYSTEM_DISPLAY_ORDER,
  DESIGN_SYSTEM_LABEL,
  DESIGN_SYSTEM_LABEL_PLURAL,
  DESIGN_SYSTEM_PATH_PREFIX,
  DESIGN_SYSTEM_TYPE,
} from '../../../identity.js';
import { DesignSystemDetail } from './detail-panel.js';
import { designSystemRoutes } from './routes.js';
import type { DesignSystemListItem } from './api.js';

/**
 * `renderRow` is fed from four places, and after tier K they no longer agree on
 * how much of a design system they carry.
 *
 * `ElementListView`, `TaggedListView`/`TaggedListMixedView` and `listByTags` all
 * hand it a row, and the agent tool renderer can hand it a wider payload — hence
 * the union, and hence `countsOf` rather than a bare `groups.length`, which is
 * what made a page containing `<tagged_list type="design-system"/>` throw on
 * render once the retired router stopped returning whole rows.
 *
 * What those rows are NOT is a `groupCount`/`tokenCount` pair. `countsOf` used
 * to branch on one, citing a `trimItem` projection that no longer exists —
 * nothing in the corpus emits either field, so the branch was dead and the
 * fallback was doing all the work. The counts are derived from `groups[]`,
 * which is what every one of these paths actually carries.
 */
function DesignSystemRow({ entity, active, onOpen }: EntityRowProps<DesignSystem | DesignSystemListItem>) {
  const counts = countsOf(entity);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition"
      style={{ background: active ? 'var(--c-accent-soft)' : 'transparent' }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--c-panel)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <Palette size={14} style={{ color: 'var(--c-accent)' }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
          {entity.title}
        </span>
        {entity.description && (
          <span className="block text-[11.5px] truncate" style={{ color: 'var(--c-subtle)' }}>
            {entity.description}
          </span>
        )}
      </span>
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {counts.groups} groups / {counts.tokens} tokens
      </span>
    </button>
  );
}

function DesignSystemChip({ slug, entity, onOpen }: EntityChipProps<DesignSystem>) {
  if (!entity) {
    return (
      <button
        onClick={onOpen}
        title={`broken reference: design-system '${slug}'`}
        className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] text-[11px] font-mono"
        style={{
          background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
          color: 'var(--c-red, #c45a3b)',
          border: '1px solid var(--c-red, #c45a3b)',
        }}
      >
        ⚠ {slug}
      </button>
    );
  }
  return (
    <button
      onClick={onOpen}
      className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] transition"
      style={{ border: '1px solid var(--c-hair)', background: 'var(--c-card)', fontSize: 12 }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <span
        className="font-mono text-[9.5px] px-1 rounded uppercase"
        style={{ background: 'var(--c-panel)', color: 'var(--c-accent)' }}
      >
        DS
      </span>
      <span style={{ color: 'var(--c-ink)' }}>{entity.title}</span>
    </button>
  );
}

function swatchColor(v: ResolvedTokenValue | undefined): string | null {
  if (typeof v !== 'string') return null;
  if (v === 'unresolved') return null;
  return v;
}

function DesignSystemCard({ slug, entity, onOpen }: EntityCardProps<DesignSystem>) {
  if (!entity) {
    return (
      <div
        className="rounded-md p-3"
        style={{
          background: 'var(--c-red-soft, rgba(196,90,59,0.08))',
          border: '1px dashed var(--c-red, #c45a3b)',
          color: 'var(--c-red, #c45a3b)',
        }}
      >
        <div className="text-[12px] font-mono">⚠ broken: design-system "{slug}"</div>
      </div>
    );
  }
  const resolved = resolve(entity.groups, entity.modes);
  const counts = countsOf(entity);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-md p-3 transition"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <div className="flex items-center gap-2">
        <Palette size={14} style={{ color: 'var(--c-accent)' }} />
        <span className="text-[14.5px]" style={{ color: 'var(--c-ink)', fontWeight: 600 }}>
          {entity.title}
        </span>
        <span
          className="font-mono text-[11px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
        >
          {counts.groups} groups / {counts.tokens} tokens
        </span>
        <span className="flex-1" />
        <ChevronRight size={14} style={{ color: 'var(--c-subtle)' }} />
      </div>
      {entity.description && (
        <div className="mt-1.5 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
          {entity.description}
        </div>
      )}
      {entity.groups.map((g) => (
        <div key={g.name} className="mt-3">
          <div
            className="text-[10.5px] uppercase font-mono tracking-wider mb-1 flex items-center gap-1.5"
            style={{ color: 'var(--c-subtle)' }}
          >
            {g.name}
            <span
              className="px-1 rounded"
              style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
            >
              {g.tier}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.tokens.map((t) => {
              const color = swatchColor(resolved[t.name]);
              return (
                <span
                  key={t.name}
                  className="inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                >
                  {color && (
                    <span
                      className="inline-block rounded-sm"
                      style={{ width: 10, height: 10, background: color, border: '1px solid var(--c-hair)' }}
                    />
                  )}
                  <span style={{ color: 'var(--c-ink)' }}>{t.name}</span>
                  <span>
                    {typeof resolved[t.name] === 'string'
                      ? (resolved[t.name] as string)
                      : 'composite'}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {entity.modes.length > 0 && (
        <div className="mt-3 text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          modes: {entity.modes.map((m) => m.name).join(', ')}
        </div>
      )}
    </button>
  );
}

export const designSystemFrontendModule: FrontendModule = {
  type: DESIGN_SYSTEM_TYPE,
  data: designSystemData,
  slugPattern: designSystemSlugPattern,
  /**
   * 2, matching the backend contribution and its `designSystemPayloadV1ToV2`.
   *
   * It said 1 while the host half said 2, from the day the halves were two
   * files in two trees. Merging them into one manifest is what made the
   * disagreement visible, and 2 is the true one — the v1 payload shape has an
   * upgrade step declared against it.
   */
  payloadVersion: 2,
  label: DESIGN_SYSTEM_LABEL,
  labelPlural: DESIGN_SYSTEM_LABEL_PLURAL,
  displayOrder: DESIGN_SYSTEM_DISPLAY_ORDER,
  pathPrefix: DESIGN_SYSTEM_PATH_PREFIX,
  renderRow: DesignSystemRow as FrontendModule['renderRow'],
  renderChip: DesignSystemChip as FrontendModule['renderChip'],
  renderCard: DesignSystemCard as FrontendModule['renderCard'],
  detailPanel: DesignSystemDetail,
  routes: designSystemRoutes,
  useGetBySlug: (slug) => useDesignSystem(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => designSystemsApi.list({ tags, tagFilter: filter }),
  // NO `editorExtensions` slash command here — see the note in the ui-view
  // module: the manifest's `commands` contribution is the declaration that
  // carries the `popoverKind` `invokeSlash` dispatches on.
  sidebarTab: {
    icon: Palette,
    label: DESIGN_SYSTEM_LABEL_PLURAL,
    order: DESIGN_SYSTEM_DISPLAY_ORDER,
  },
};
