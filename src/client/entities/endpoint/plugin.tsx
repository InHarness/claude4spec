import { ArrowRightLeft, ChevronRight } from 'lucide-react';
import type { Endpoint } from '../../../shared/entities.js';
import { METHOD_STYLE } from '../../components/atoms.js';
import { Badge } from '../../host-ui-kit/actions/Badge.js';
import { useEndpoint } from '../../hooks/useEndpoints.js';
import { endpointsApi } from './api.js';
import {
  registerEntity,
  type EntityCardProps,
  type EntityChipProps,
  type EntityRowProps,
} from '../registry.js';
import { registerEditorExtension } from '../../tiptap/registry.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import type { FrontendModule } from '../../core/plugin-host/types.js';
import { EndpointDetail } from './detail-panel.js';

function EndpointRow({ entity, active, onOpen }: EntityRowProps<Endpoint>) {
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
      <Badge
        label={METHOD_STYLE[entity.method].label}
        color={METHOD_STYLE[entity.method].bg}
        foreground={METHOD_STYLE[entity.method].fg}
        active
        dot={false}
        mono
        small
      />
      <span className="flex-1 min-w-0">
        <span
          className="block font-mono text-[12.5px] truncate"
          style={{ color: 'var(--c-ink)' }}
        >
          {entity.path}
        </span>
        {entity.summary && (
          <span className="block text-[11.5px] truncate" style={{ color: 'var(--c-subtle)' }}>
            {entity.summary}
          </span>
        )}
      </span>
    </button>
  );
}

function EndpointChip({ slug, entity, onOpen }: EntityChipProps<Endpoint>) {
  if (!entity) {
    return (
      <button
        onClick={onOpen}
        title={`broken reference: endpoint '${slug}'`}
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
      className="inline-flex items-center gap-1 align-middle rounded px-1 py-[1px] transition"
      style={{ border: '1px solid var(--c-hair)', background: 'var(--c-card)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <Badge
        label={METHOD_STYLE[entity.method].label}
        color={METHOD_STYLE[entity.method].bg}
        foreground={METHOD_STYLE[entity.method].fg}
        active
        dot={false}
        mono
        small
      />
      <span className="font-mono text-[12px]" style={{ color: 'var(--c-ink)' }}>
        {entity.path}
      </span>
    </button>
  );
}

function EndpointCard({ slug, entity, onOpen }: EntityCardProps<Endpoint>) {
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
        <div className="text-[12px] font-mono">⚠ broken: endpoint "{slug}"</div>
        <div className="text-[11.5px] mt-1" style={{ opacity: 0.8 }}>
          entity not found — use agent or sidebar to create it
        </div>
      </div>
    );
  }
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-md p-3 transition"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <div className="flex items-center gap-2">
        <Badge
          label={METHOD_STYLE[entity.method].label}
          color={METHOD_STYLE[entity.method].bg}
          foreground={METHOD_STYLE[entity.method].fg}
          active
          dot={false}
          mono
        />
        <span className="font-mono text-[14px]" style={{ color: 'var(--c-ink)', fontWeight: 600 }}>
          {entity.path}
        </span>
        <span className="flex-1" />
        <ChevronRight size={14} style={{ color: 'var(--c-subtle)' }} />
      </div>
      {entity.summary && (
        <div className="mt-1.5 text-[13px]" style={{ color: 'var(--c-muted)' }}>
          {entity.summary}
        </div>
      )}
      {entity.description && (
        <div className="mt-1 text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
          {entity.description}
        </div>
      )}
      {entity.tags.length > 0 && (
        <div className="mt-2 flex items-center gap-1 flex-wrap">
          {entity.tags.map((t) => (
            <span
              key={t}
              className="text-[10.5px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

const endpointFrontendModule: FrontendModule = {
  type: 'endpoint',
  table: 'endpoint',
  label: 'Endpoint',
  labelPlural: 'Endpoints',
  displayOrder: 10,
  pathPrefix: '/endpoints',
  slugFrom: (data) => {
    const d = data as { method?: string; path?: string };
    const method = (d.method ?? 'GET').toLowerCase();
    const path = (d.path ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${method}-${path}`.replace(/^-+|-+$/g, '');
  },
  renderRow: EndpointRow as FrontendModule['renderRow'],
  renderChip: EndpointChip as FrontendModule['renderChip'],
  renderCard: EndpointCard as FrontendModule['renderCard'],
  detailPanel: EndpointDetail,
  useGetBySlug: (slug) => useEndpoint(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => endpointsApi.list({ tags, tagFilter: filter }),
  sidebarTab: { icon: ArrowRightLeft, label: 'Endpoints', order: 10 },
};

clientPluginHost.registerFrontendModule(endpointFrontendModule);

registerEntity<Endpoint>({
  type: 'endpoint',
  label: 'Endpoint',
  labelPlural: 'Endpoints',
  renderRow: EndpointRow,
  renderChip: EndpointChip,
  renderCard: EndpointCard,
  detailPanel: EndpointDetail,
  useGetBySlug: (slug) => useEndpoint(slug),
});

registerEditorExtension({
  name: 'endpoint-slash',
  slashCommand: {
    id: 'endpoint',
    label: '/endpoint',
    description: 'Create a new endpoint inline',
    hint: 'method + path',
  },
});
