import { ChevronRight, Database, Key, Link as LinkIcon } from 'lucide-react';
import type { DatabaseTable } from '../../../shared/entities.js';
import { useDatabaseTable } from '../../hooks/useDatabaseTables.js';
import { databaseTablesApi } from './api.js';
import {
  registerEntity,
  type EntityCardProps,
  type EntityChipProps,
  type EntityRowProps,
} from '../registry.js';
import { registerEditorExtension } from '../../tiptap/registry.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import type { FrontendModule } from '../../core/plugin-host/types.js';
import { DatabaseTableDetail } from './detail-panel.js';
import { databaseTableRoutes } from './routes.js';

function DatabaseTableRow({ entity, active, onOpen }: EntityRowProps<DatabaseTable>) {
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
      <Database size={14} style={{ color: 'var(--c-accent)' }} />
      <span className="flex-1 min-w-0">
        <span
          className="block font-mono text-[12.5px]"
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
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {entity.columns.length}c
      </span>
    </button>
  );
}

function DatabaseTableChip({ slug, entity, onOpen }: EntityChipProps<DatabaseTable>) {
  if (!entity) {
    return (
      <button
        onClick={onOpen}
        title={`broken reference: database-table '${slug}'`}
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
      <Database size={11} style={{ color: 'var(--c-accent)' }} />
      <span className="font-mono" style={{ color: 'var(--c-ink)' }}>
        {entity.name}
      </span>
    </button>
  );
}

function DatabaseTableCard({ slug, entity, onOpen }: EntityCardProps<DatabaseTable>) {
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
        <div className="text-[12px] font-mono">⚠ broken: database-table "{slug}"</div>
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
        <Database size={14} style={{ color: 'var(--c-accent)' }} />
        <span
          className="font-mono text-[14.5px]"
          style={{ color: 'var(--c-ink)', fontWeight: 600 }}
        >
          {entity.name}
        </span>
        <span className="flex-1" />
        <ChevronRight size={14} style={{ color: 'var(--c-subtle)' }} />
      </div>
      {entity.description && (
        <div className="mt-1.5 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
          {entity.description}
        </div>
      )}
      {entity.columns.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {entity.columns.slice(0, 8).map((c) => (
            <li
              key={c.name}
              className="font-mono text-[12px] flex items-center gap-1.5"
              style={{ color: 'var(--c-muted)' }}
            >
              {c.pk && (
                <Key
                  size={10}
                  style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}
                  aria-label="primary key"
                />
              )}
              {!c.pk && c.fk && (
                <LinkIcon
                  size={10}
                  style={{ color: 'var(--c-subtle)' }}
                  aria-label="foreign key"
                />
              )}
              {!c.pk && !c.fk && <span style={{ width: 10 }} />}
              <span style={{ color: 'var(--c-ink)' }}>{c.name}</span>
              <span style={{ color: 'var(--c-subtle)' }}>:</span>
              <span>{c.type}</span>
              {c.nullable === false && !c.pk && (
                <span
                  className="text-[10px] px-1 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                >
                  not null
                </span>
              )}
              {c.unique && !c.pk && (
                <span
                  className="text-[10px] px-1 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                >
                  unique
                </span>
              )}
              {c.fk && (
                <span className="text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                  → {c.fk.table}.{c.fk.column}
                </span>
              )}
            </li>
          ))}
          {entity.columns.length > 8 && (
            <li className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
              … +{entity.columns.length - 8} more
            </li>
          )}
        </ul>
      )}
      {entity.indexes.length > 0 && (
        <div
          className="mt-2 pt-2 text-[11px]"
          style={{ color: 'var(--c-subtle)', borderTop: '1px dashed var(--c-hair)' }}
        >
          {entity.indexes.length} index{entity.indexes.length === 1 ? '' : 'es'}
        </div>
      )}
    </button>
  );
}

const databaseTableFrontendModule: FrontendModule = {
  type: 'database-table',
  table: 'database_table',
  label: 'Database Table',
  labelPlural: 'Database Tables',
  displayOrder: 30,
  pathPrefix: '/database-tables',
  slugFrom: (data) => {
    const name = (data as { name?: string }).name ?? '';
    return name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },
  renderRow: DatabaseTableRow as FrontendModule['renderRow'],
  renderChip: DatabaseTableChip as FrontendModule['renderChip'],
  renderCard: DatabaseTableCard as FrontendModule['renderCard'],
  detailPanel: DatabaseTableDetail,
  useGetBySlug: (slug) => useDatabaseTable(slug) as ReturnType<FrontendModule['useGetBySlug']>,
  listByTags: ({ tags, filter }) => databaseTablesApi.list({ tags, tagFilter: filter }),
  sidebarTab: { icon: Database, label: 'Database Tables', order: 30 },
  // M33 phase 3: this built-in contributes its `/database-tables` pages as a
  // RouteTreeFragment (transitional — see ./routes.tsx) instead of the host
  // hardcoding them in router.tsx.
  routes: databaseTableRoutes,
};

clientPluginHost.registerFrontendModule(databaseTableFrontendModule);

registerEntity<DatabaseTable>({
  type: 'database-table',
  label: 'Database Table',
  labelPlural: 'Database Tables',
  renderRow: DatabaseTableRow,
  renderChip: DatabaseTableChip,
  renderCard: DatabaseTableCard,
  detailPanel: DatabaseTableDetail,
  useGetBySlug: (slug) => useDatabaseTable(slug),
});

registerEditorExtension({
  name: 'database-table-slash',
  slashCommand: {
    id: 'database-table',
    label: '/dbtable',
    description: 'Create a new database table inline',
    hint: 'name',
  },
});
