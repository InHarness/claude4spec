import { ChevronRight, Monitor } from 'lucide-react';
import type { UiView } from '../../../shared/entities.js';
import { useUiView } from '../../hooks/useUiViews.js';
import { uiViewsApi } from './api.js';
import {
  registerEntity,
  type EntityCardProps,
  type EntityChipProps,
  type EntityRowProps,
} from '../registry.js';
import { registerEditorExtension } from '../../tiptap/registry.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import type { FrontendModule } from '../../core/plugin-host/types.js';
import { UiViewDetail } from './detail-panel.js';

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
          {entity.name}
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
      <span style={{ color: 'var(--c-ink)' }}>{entity.name}</span>
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
          {entity.name}
        </span>
        {entity.url && (
          <span
            className="font-mono text-[12px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
          >
            {entity.url}
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

const uiViewFrontendModule: FrontendModule = {
  type: 'ui-view',
  table: 'ui_view',
  label: 'UI View',
  labelPlural: 'UI Views',
  displayOrder: 40,
  pathPrefix: '/ui-views',
  slugFrom: (data) => {
    const name = (data as { name?: string }).name ?? '';
    return name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },
  renderRow: UiViewRow as FrontendModule['renderRow'],
  renderChip: UiViewChip as FrontendModule['renderChip'],
  renderCard: UiViewCard as FrontendModule['renderCard'],
  detailPanel: UiViewDetail,
  useGetBySlug: (slug) => useUiView(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => uiViewsApi.list({ tags, tagFilter: filter }),
  sidebarTab: { icon: Monitor, label: 'UI Views', order: 40 },
};

clientPluginHost.registerFrontendModule(uiViewFrontendModule);

registerEntity<UiView>({
  type: 'ui-view',
  label: 'UI View',
  labelPlural: 'UI Views',
  renderRow: UiViewRow,
  renderChip: UiViewChip,
  renderCard: UiViewCard,
  detailPanel: UiViewDetail,
  useGetBySlug: (slug) => useUiView(slug),
});

registerEditorExtension({
  name: 'ui-view-slash',
  slashCommand: {
    id: 'ui-view',
    label: '/uiview',
    description: 'Create a new UI view inline',
    hint: 'name',
  },
});
