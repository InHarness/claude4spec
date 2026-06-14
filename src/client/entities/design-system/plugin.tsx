import { ChevronRight, Palette } from 'lucide-react';
import type { DesignSystem, ResolvedTokenValue } from '../../../shared/entities.js';
import { resolve } from '../../../shared/design-system.js';
import { useDesignSystem } from '../../hooks/useDesignSystems.js';
import { designSystemsApi } from './api.js';
import {
  registerEntity,
  type EntityCardProps,
  type EntityChipProps,
  type EntityRowProps,
} from '../registry.js';
import { registerEditorExtension } from '../../tiptap/registry.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import type { FrontendModule } from '../../core/plugin-host/types.js';
import { DesignSystemDetail } from './detail-panel.js';

function tokenCountOf(ds: DesignSystem): number {
  return ds.groups.reduce((acc, g) => acc + g.tokens.length, 0);
}

function DesignSystemRow({ entity, active, onOpen }: EntityRowProps<DesignSystem>) {
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
          {entity.name}
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
        {entity.groups.length} groups / {tokenCountOf(entity)} tokens
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
      <span style={{ color: 'var(--c-ink)' }}>{entity.name}</span>
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
          {entity.name}
        </span>
        <span
          className="font-mono text-[11px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
        >
          {entity.groups.length} groups / {tokenCountOf(entity)} tokens
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

const designSystemFrontendModule: FrontendModule = {
  type: 'design-system',
  table: 'design_system',
  label: 'Design System',
  labelPlural: 'Design Systems',
  displayOrder: 60,
  pathPrefix: '/design-systems',
  slugFrom: (data) => {
    const name = (data as { name?: string }).name ?? '';
    return name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },
  renderRow: DesignSystemRow as FrontendModule['renderRow'],
  renderChip: DesignSystemChip as FrontendModule['renderChip'],
  renderCard: DesignSystemCard as FrontendModule['renderCard'],
  detailPanel: DesignSystemDetail,
  useGetBySlug: (slug) => useDesignSystem(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => designSystemsApi.list({ tags, tagFilter: filter }),
  sidebarTab: { icon: Palette, label: 'Design Systems', order: 60 },
};

clientPluginHost.registerFrontendModule(designSystemFrontendModule);

registerEntity<DesignSystem>({
  type: 'design-system',
  label: 'Design System',
  labelPlural: 'Design Systems',
  renderRow: DesignSystemRow,
  renderChip: DesignSystemChip,
  renderCard: DesignSystemCard,
  detailPanel: DesignSystemDetail,
  useGetBySlug: (slug) => useDesignSystem(slug),
});

registerEditorExtension({
  name: 'design-system-slash',
  slashCommand: {
    id: 'design-system',
    label: '/design-system',
    description: 'Create a new design system inline',
    hint: 'name',
  },
});
