import { Braces, ChevronRight } from 'lucide-react';
import type { Dto } from '../../../types.js';
import { useDto } from './hooks.js';
import { dtosApi } from './api.js';
import { dtoData, dtoSlugPattern } from '../schema.js';
import type {
  EntityCardProps,
  EntityChipProps,
  EntityRowProps,
  FrontendModule,
} from '@c4s/plugin-runtime';
import { DtoDetail } from './detail-panel.js';
import { dtoRoutes } from './routes.js';

function DtoRow({ entity, active, onOpen }: EntityRowProps<Dto>) {
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
      <Braces size={14} style={{ color: 'var(--c-accent)' }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
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
        {entity.fields.length}f
      </span>
    </button>
  );
}

function DtoChip({ slug, entity, onOpen }: EntityChipProps<Dto>) {
  if (!entity) {
    return (
      <button
        onClick={onOpen}
        title={`broken reference: dto '${slug}'`}
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
      <Braces size={11} style={{ color: 'var(--c-accent)' }} />
      <span style={{ color: 'var(--c-ink)' }}>{entity.title}</span>
    </button>
  );
}

function DtoCard({ slug, entity, onOpen }: EntityCardProps<Dto>) {
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
        <div className="text-[12px] font-mono">⚠ broken: dto "{slug}"</div>
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
        <Braces size={14} style={{ color: 'var(--c-accent)' }} />
        <span className="text-[15px]" style={{ color: 'var(--c-ink)', fontWeight: 600 }}>
          {entity.title}
        </span>
        <span className="flex-1" />
        <ChevronRight size={14} style={{ color: 'var(--c-subtle)' }} />
      </div>
      {entity.description && (
        <div className="mt-1.5 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
          {entity.description}
        </div>
      )}
      {entity.fields.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {entity.fields.slice(0, 6).map((f) => (
            <li
              key={f.name}
              className="font-mono text-[12px] flex items-center gap-1.5"
              style={{ color: 'var(--c-muted)' }}
            >
              <span style={{ color: 'var(--c-ink)' }}>{f.name}</span>
              <span style={{ color: 'var(--c-subtle)' }}>:</span>
              <span>{f.type}</span>
              {f.required && (
                <span
                  className="text-[10px] px-1 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-accent-ink, var(--c-accent))' }}
                >
                  req
                </span>
              )}
            </li>
          ))}
          {entity.fields.length > 6 && (
            <li className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
              … +{entity.fields.length - 6} more
            </li>
          )}
        </ul>
      )}
    </button>
  );
}

export const dtoFrontendModule: FrontendModule = {
  type: 'dto',
  // Host API 2.0.0 — the SAME declaration the backend contribution carries, not
  // a second copy. The hand-inlined `slugFrom` this replaces was a mirror of the
  // server's `dtoSlug`, maintained by hand and free to drift from it.
  data: dtoData,
  slugPattern: dtoSlugPattern,
  payloadVersion: 1,
  label: 'DTO',
  labelPlural: 'DTOs',
  displayOrder: 20,
  pathPrefix: '/dtos',
  renderRow: DtoRow as FrontendModule['renderRow'],
  renderChip: DtoChip as FrontendModule['renderChip'],
  renderCard: DtoCard as FrontendModule['renderCard'],
  detailPanel: DtoDetail,
  useGetBySlug: (slug) => useDto(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => dtosApi.list({ tags, tagFilter: filter }),
  routes: dtoRoutes,
  // NO `editorExtensions` slash command here. The manifest's `commands`
  // contribution (`capabilities/commands.ts`) is the one that works: it carries
  // a `popoverKind`, which is what `invokeSlash` dispatches on. A second entry
  // declared here would carry none, and since the host filters the palette by
  // substring both would show for `/{trigger}` — with THIS one selected by
  // default, because frontend modules mount before plugin commands register.
  // Choosing it deleted the typed text and opened nothing.
  sidebarTab: { icon: Braces, label: 'DTOs', order: 20 },
};
