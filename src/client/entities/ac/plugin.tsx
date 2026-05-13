import { CheckSquare, ChevronRight } from 'lucide-react';
import type { Ac } from '../../../shared/entities.js';
import { useAc } from '../../hooks/useAcs.js';
import { acsApi } from './api.js';
import {
  registerEntity,
  type EntityCardProps,
  type EntityChipProps,
  type EntityRowProps,
} from '../registry.js';
import { registerEditorExtension } from '../../tiptap/registry.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import type { FrontendModule } from '../../core/plugin-host/types.js';
import { AcDetail } from './detail-panel.js';
import { acSlugClient } from './slug.js';

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n).trimEnd()}…`;
}

function AcRow({ entity, active, onOpen }: EntityRowProps<Ac>) {
  const deprecated = entity.status === 'deprecated';
  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition"
      style={{
        background: active ? 'var(--c-accent-soft)' : 'transparent',
        opacity: deprecated ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--c-panel)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <CheckSquare size={14} style={{ color: 'var(--c-accent)' }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
          {truncate(entity.text, 80)}
        </span>
        <span className="block text-[10.5px] font-mono uppercase tracking-wider" style={{ color: 'var(--c-subtle)' }}>
          {entity.kind}
          {deprecated && ' · deprecated'}
        </span>
      </span>
      {entity.verifies.length > 0 && (
        <span
          className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
          title={`Verifies ${entity.verifies.length} entity reference(s)`}
        >
          ↪{entity.verifies.length}
        </span>
      )}
    </button>
  );
}

function AcChip({ slug, entity, onOpen }: EntityChipProps<Ac>) {
  if (!entity) {
    return (
      <button
        onClick={onOpen}
        title={`broken reference: ac '${slug}'`}
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
  const deprecated = entity.status === 'deprecated';
  return (
    <button
      onClick={onOpen}
      className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] transition"
      style={{
        border: '1px solid var(--c-hair)',
        background: 'var(--c-card)',
        fontSize: 12,
        opacity: deprecated ? 0.65 : 1,
        textDecoration: deprecated ? 'line-through' : undefined,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
      title={entity.text}
    >
      <CheckSquare size={11} style={{ color: 'var(--c-accent)' }} />
      <span style={{ color: 'var(--c-ink)' }}>{truncate(entity.text, 50)}</span>
    </button>
  );
}

function AcCard({ slug, entity, onOpen }: EntityCardProps<Ac>) {
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
        <div className="text-[12px] font-mono">⚠ broken: ac "{slug}"</div>
      </div>
    );
  }
  const deprecated = entity.status === 'deprecated';
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-md p-3 transition"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair)',
        opacity: deprecated ? 0.7 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <div className="flex items-start gap-2">
        <CheckSquare size={14} style={{ color: 'var(--c-accent)', marginTop: 2 }} />
        <span
          className="flex-1 text-[14px]"
          style={{
            color: 'var(--c-ink)',
            fontWeight: 500,
            textDecoration: deprecated ? 'line-through' : undefined,
          }}
        >
          {entity.text}
        </span>
        <ChevronRight size={14} style={{ color: 'var(--c-subtle)', marginTop: 2 }} />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-wider" style={{ color: 'var(--c-subtle)' }}>
        <span>{entity.kind}</span>
        {deprecated && <span>· deprecated</span>}
        {entity.verifies.length > 0 && (
          <span title="verifies count">· verifies {entity.verifies.length}</span>
        )}
      </div>
    </button>
  );
}

const acFrontendModule: FrontendModule = {
  type: 'ac',
  table: 'ac',
  label: 'Acceptance Criterion',
  labelPlural: 'Acceptance Criteria',
  displayOrder: 50,
  pathPrefix: '/acs',
  slugFrom: (data) => acSlugClient((data as { text?: string }).text ?? ''),
  renderRow: AcRow as FrontendModule['renderRow'],
  renderChip: AcChip as FrontendModule['renderChip'],
  renderCard: AcCard as FrontendModule['renderCard'],
  detailPanel: AcDetail,
  useGetBySlug: (slug) => useAc(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => acsApi.list({ tags, tagFilter: filter, status: 'all' }),
  sidebarTab: { icon: CheckSquare, label: 'Acceptance Criteria', order: 50 },
};

clientPluginHost.registerFrontendModule(acFrontendModule);

registerEntity<Ac>({
  type: 'ac',
  label: 'Acceptance Criterion',
  labelPlural: 'Acceptance Criteria',
  renderRow: AcRow,
  renderChip: AcChip,
  renderCard: AcCard,
  detailPanel: AcDetail,
  useGetBySlug: (slug) => useAc(slug),
});

registerEditorExtension({
  name: 'ac-slash',
  slashCommand: {
    id: 'ac',
    label: '/ac',
    description: 'Create a new acceptance criterion inline',
    hint: 'observable behavior…',
  },
});
