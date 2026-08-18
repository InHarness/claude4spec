import { uiViewData, uiViewSlugPattern } from '../schema.js';
import { ChevronRight, Monitor } from 'lucide-react';
import type { UiView } from '../../../types.js';
import { useUiView } from './hooks.js';
import { uiViewsApi } from './api.js';
import type {
  EntityCardProps,
  EntityChipProps,
  EntityRowProps,
  FrontendModule,
} from '@c4s/plugin-runtime';
import {
  UI_VIEW_DISPLAY_ORDER,
  UI_VIEW_LABEL,
  UI_VIEW_LABEL_PLURAL,
  UI_VIEW_PATH_PREFIX,
  UI_VIEW_TYPE,
} from '../../../identity.js';
import { UiViewDetail } from './detail-panel.js';
import { uiViewRoutes } from './routes.js';

function UiViewRow({ entity, active, onOpen }: EntityRowProps<UiView>) {
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
      <Monitor size={14} style={{ color: 'var(--c-accent)' }} />
      <span className="flex-1 min-w-0">
        <span
          className="block text-[12.5px]"
          style={{ color: 'var(--c-ink)', fontWeight: 500 }}
        >
          {entity.title}
        </span>
        {entity.description && (
          <span className="block text-[11.5px] truncate" style={{ color: 'var(--c-subtle)' }}>
            {entity.description}
          </span>
        )}
      </span>
      {entity.url && (
        <span
          className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
        >
          {entity.url}
        </span>
      )}
    </button>
  );
}

function UiViewChip({ slug, entity, onOpen }: EntityChipProps<UiView>) {
  if (!entity) {
    return (
      <button
        onClick={onOpen}
        title={`broken reference: ui-view '${slug}'`}
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
      style={{
        border: '1px solid var(--c-hair)',
        background: 'var(--c-card)',
        fontSize: 12,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <Monitor size={11} style={{ color: 'var(--c-accent)' }} />
      <span style={{ color: 'var(--c-ink)' }}>{entity.title}</span>
      {entity.url && (
        <span className="font-mono text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          ({entity.url})
        </span>
      )}
    </button>
  );
}

const ORDER: Record<string, number> = { path: 0, query: 1, hash: 2 };

function UiViewCard({ slug, entity, onOpen }: EntityCardProps<UiView>) {
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
        <div className="text-[12px] font-mono">⚠ broken: ui-view "{slug}"</div>
      </div>
    );
  }
  const sortedParams = [...entity.params].sort(
    (a, b) => (ORDER[a.in] ?? 9) - (ORDER[b.in] ?? 9)
  );
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-md p-3 transition"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <div className="flex items-center gap-2">
        <Monitor size={14} style={{ color: 'var(--c-accent)' }} />
        <span
          className="text-[14.5px]"
          style={{ color: 'var(--c-ink)', fontWeight: 600 }}
        >
          {entity.title}
        </span>
        {entity.url && (
          <span
            className="font-mono text-[12px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
          >
            {entity.url}
          </span>
        )}
        {entity.designSystemSlug && (
          <span
            className="inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
            title={`design system: ${entity.designSystemSlug}`}
          >
            <span
              className="text-[9px] px-1 rounded uppercase"
              style={{ background: 'var(--c-card)', color: 'var(--c-accent)' }}
            >
              DS
            </span>
            {entity.designSystemSlug}
          </span>
        )}
        <span className="flex-1" />
        <ChevronRight size={14} style={{ color: 'var(--c-subtle)' }} />
      </div>
      {entity.description && (
        <div className="mt-1.5 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
          {entity.description}
        </div>
      )}
      {sortedParams.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {sortedParams.map((p, i) => (
            <li
              key={`${p.in}-${p.name}-${i}`}
              className="font-mono text-[12px] flex items-center gap-1.5"
              style={{ color: 'var(--c-muted)' }}
            >
              <span
                className="text-[10px] px-1 rounded uppercase"
                style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
              >
                {p.in}
              </span>
              <span style={{ color: 'var(--c-ink)' }}>{p.name}</span>
              {p.type && (
                <>
                  <span style={{ color: 'var(--c-subtle)' }}>:</span>
                  <span>{p.type}</span>
                </>
              )}
              {p.required && (
                <span
                  className="text-[10px] px-1 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                >
                  required
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}

export const uiViewFrontendModule: FrontendModule = {
  type: UI_VIEW_TYPE,
  data: uiViewData,
  slugPattern: uiViewSlugPattern,
  // Mirrors the backend contribution (`entity/ui-view/index.ts`); the two
  // declaring different versions is how a frontend quietly reads a shape the
  // server no longer writes.
  payloadVersion: 3,
  label: UI_VIEW_LABEL,
  labelPlural: UI_VIEW_LABEL_PLURAL,
  displayOrder: UI_VIEW_DISPLAY_ORDER,
  pathPrefix: UI_VIEW_PATH_PREFIX,
  renderRow: UiViewRow as FrontendModule['renderRow'],
  renderChip: UiViewChip as FrontendModule['renderChip'],
  renderCard: UiViewCard as FrontendModule['renderCard'],
  detailPanel: UiViewDetail,
  routes: uiViewRoutes,
  useGetBySlug: (slug) => useUiView(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => uiViewsApi.list({ tags, tagFilter: filter }),
  // NO `editorExtensions` slash command here. The manifest's `commands`
  // contribution (`capabilities/commands.ts`) is the one that works: it carries
  // a `popoverKind`, which is what `invokeSlash` dispatches on. A second entry
  // declared here would carry none, and since the host filters the palette by
  // substring both would show for `/uiview` — with THIS one selected by
  // default, because frontend modules mount before plugin commands register.
  // Choosing it deletes the typed text and opens nothing.
  sidebarTab: { icon: Monitor, label: UI_VIEW_LABEL_PLURAL, order: UI_VIEW_DISPLAY_ORDER },
};
