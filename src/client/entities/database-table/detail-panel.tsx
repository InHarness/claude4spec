import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, Database, Key, Plus, Trash } from 'lucide-react';
import { TagChip } from '../../components/atoms.js';
import { DocEditor } from '../../components/DocEditor.js';
import {
  useDatabaseTable,
  useDatabaseTables,
  useDeleteDatabaseTable,
  useUpdateDatabaseTable,
} from '../../hooks/useDatabaseTables.js';
import { useTags } from '../../hooks/useTags.js';
import { useReferences } from '../../hooks/useReferences.js';
import { confirmDestructive, openPopover, toast } from '../../ui/events.js';
import type {
  DatabaseTable,
  DatabaseTableColumn,
  DatabaseTableIndex,
  EntityType,
} from '../../../shared/entities.js';

interface Props {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onViewHistory: () => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenPage?: (path: string) => void;
}

interface Draft {
  name: string;
  description: string;
  columns: DatabaseTableColumn[];
  indexes: DatabaseTableIndex[];
  tags: string[];
}

const SUGGESTED_TYPES = [
  'string',
  'text',
  'int',
  'bigint',
  'float',
  'decimal',
  'boolean',
  'timestamp',
  'date',
  'uuid',
  'json',
  'enum',
  'binary',
];

function toDraft(d: DatabaseTable): Draft {
  return {
    name: d.name,
    description: d.description ?? '',
    columns: d.columns,
    indexes: d.indexes,
    tags: d.tags,
  };
}

export function DatabaseTableDetail({
  slug,
  onDeleted,
  onRenamed,
  onViewHistory,
  onOpenEntity,
  onOpenPage,
}: Props) {
  const { data: dbTable, isLoading, error } = useDatabaseTable(slug);
  const update = useUpdateDatabaseTable();
  const remove = useDeleteDatabaseTable();
  const { data: allTags = [] } = useTags();
  const { data: allTables = [] } = useDatabaseTables();
  const { data: refs = [] } = useReferences('database-table', dbTable?.slug ?? null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const baselineRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!dbTable) return;
    const next = toDraft(dbTable);
    const snapshot = JSON.stringify(next);
    if (baselineRef.current === snapshot) return;
    baselineRef.current = snapshot;
    setDraft(next);
  }, [dbTable]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    []
  );

  const dirty = useMemo(() => {
    if (!draft || !dbTable) return false;
    return JSON.stringify(draft) !== baselineRef.current;
  }, [draft, dbTable]);

  const knownTableSlugs = useMemo(
    () => new Set(allTables.map((t) => t.slug)),
    [allTables]
  );

  function scheduleAutosave(next: Draft) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void runSave(next), 500);
  }

  async function runSave(current: Draft) {
    if (!dbTable) return;
    try {
      const updated = await update.mutateAsync({
        slug: dbTable.slug,
        input: {
          name: current.name,
          description: current.description || null,
          columns: current.columns,
          indexes: current.indexes,
          tags: current.tags,
        },
      });
      baselineRef.current = JSON.stringify(toDraft(updated));
      setWarnings(updated.warnings ?? []);
      if (updated.slug !== dbTable.slug) onRenamed(updated.slug);
    } catch (err) {
      console.error('autosave failed', err);
    }
  }

  function patch(partial: Partial<Draft>) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...partial };
      scheduleAutosave(next);
      return next;
    });
  }

  async function handleDelete() {
    if (!dbTable) return;
    const dangling = allTables.flatMap((t) =>
      t.columns
        .filter((c) => c.fk?.table === dbTable.slug)
        .map((c) => `${t.slug}.${c.name}`),
    );
    const body = dangling.length
      ? `Delete database table ${dbTable.name}? ${dangling.length} foreign key${
          dangling.length === 1 ? '' : 's'
        } will become dangling:\n${dangling.slice(0, 10).join('\n')}${
          dangling.length > 10 ? '\n…' : ''
        }`
      : `Delete database table ${dbTable.name}? This cannot be undone.`;
    const ok = await confirmDestructive({
      title: 'Delete database table?',
      body,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(dbTable.slug);
      onDeleted();
      toast.success(`Table ${dbTable.name} deleted`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function toggleTag(tagSlug: string) {
    if (!draft) return;
    const next = draft.tags.includes(tagSlug)
      ? draft.tags.filter((t) => t !== tagSlug)
      : [...draft.tags, tagSlug];
    patch({ tags: next });
  }

  async function addNewTag(e: React.MouseEvent<HTMLElement>) {
    if (!draft) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const result = await openPopover(
      'create-tag',
      { x: rect.left, y: rect.bottom + 4 },
      { contextLabel: dbTable?.name },
    );
    if (!result) return;
    const tslug = result.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!tslug || draft.tags.includes(tslug)) return;
    patch({ tags: [...draft.tags, tslug] });
  }

  function updateColumn(index: number, partial: Partial<DatabaseTableColumn>) {
    if (!draft) return;
    const columns = draft.columns.map((c, i) => (i === index ? { ...c, ...partial } : c));
    patch({ columns });
  }

  function removeColumn(index: number) {
    if (!draft) return;
    patch({ columns: draft.columns.filter((_, i) => i !== index) });
  }

  function addColumn() {
    if (!draft) return;
    patch({
      columns: [
        ...draft.columns,
        { name: '', type: 'string', nullable: true },
      ],
    });
  }

  function updateIndex(index: number, partial: Partial<DatabaseTableIndex>) {
    if (!draft) return;
    const indexes = draft.indexes.map((x, i) => (i === index ? { ...x, ...partial } : x));
    patch({ indexes });
  }

  function removeIndex(index: number) {
    if (!draft) return;
    patch({ indexes: draft.indexes.filter((_, i) => i !== index) });
  }

  function addIndex() {
    if (!draft) return;
    patch({ indexes: [...draft.indexes, { columns: [] }] });
  }

  if (isLoading && !dbTable) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading database table…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-red)' }}>
        Failed to load: {(error as Error).message}
      </div>
    );
  }
  if (!dbTable || !draft) return null;

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <datalist id="database-table-slugs">
        {allTables
          .filter((t) => t.slug !== dbTable.slug)
          .map((t) => (
            <option key={t.slug} value={t.slug} />
          ))}
      </datalist>
      <div className="mx-auto" style={{ maxWidth: 960, padding: '48px 56px 140px' }}>
        <div
          className="flex items-center gap-2 mb-1 text-[11px]"
          style={{ color: 'var(--c-subtle)' }}
        >
          <span className="font-mono">{dbTable.slug}</span>
          <span>·</span>
          <span>
            updated{' '}
            {new Date(dbTable.updatedAt.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
          {update.isPending && (
            <span style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}>saving…</span>
          )}
          {!update.isPending && dirty && (
            <span style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}>edited</span>
          )}
          <span className="flex-1" />
          <button
            onClick={onViewHistory}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
            style={{ color: 'var(--c-muted)' }}
            title="History"
          >
            <Clock size={11} /> History
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
            style={{ color: 'var(--c-red, #c45a3b)' }}
            title="Delete"
          >
            <Trash size={11} /> Delete
          </button>
        </div>

        <div className="flex items-center gap-2 mt-2 mb-1">
          <Database size={22} style={{ color: 'var(--c-accent)' }} />
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="flex-1 bg-transparent outline-none font-mono"
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: 'var(--c-ink)',
            }}
            placeholder="table_name"
            spellCheck={false}
          />
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {draft.tags.map((tslug) => {
            const t = allTags.find((x) => x.slug === tslug);
            return (
              <TagChip
                key={tslug}
                tag={t ?? { slug: tslug, name: tslug, color: null }}
                active
                small
                onRemove={() => toggleTag(tslug)}
              />
            );
          })}
          <button
            onClick={() => setShowTagPicker((s) => !s)}
            className="text-[11.5px] px-2 py-0.5 rounded-full"
            style={{ color: 'var(--c-subtle)', border: '1px dashed var(--c-hair-strong)' }}
          >
            + tag
          </button>
          {showTagPicker && (
            <div className="w-full mt-1 flex items-center gap-1.5 flex-wrap">
              <span
                className="text-[10px] uppercase font-mono tracking-wider mr-1"
                style={{ color: 'var(--c-subtle)' }}
              >
                pick:
              </span>
              {allTags
                .filter((t) => !draft.tags.includes(t.slug))
                .map((t) => (
                  <TagChip key={t.slug} tag={t} small onClick={() => toggleTag(t.slug)} />
                ))}
              <button
                onClick={addNewTag}
                className="text-[11.5px] px-2 py-0.5 rounded-full"
                style={{ color: 'var(--c-subtle)', border: '1px dashed var(--c-hair-strong)' }}
              >
                new…
              </button>
            </div>
          )}
        </div>

        {warnings.length > 0 && (
          <div
            className="mt-4 rounded-md p-3"
            style={{
              background: 'var(--c-yellow-soft, rgba(196,162,79,0.12))',
              border: '1px dashed var(--c-yellow, #c4a24f)',
            }}
          >
            <div
              className="flex items-center gap-1.5 mb-1 text-[11px] uppercase font-mono tracking-wider"
              style={{ color: 'var(--c-yellow-ink, #c4a24f)' }}
            >
              <AlertTriangle size={11} />
              Warnings
            </div>
            <ul className="text-[12px] space-y-0.5" style={{ color: 'var(--c-ink)' }}>
              {warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8">
          <SectionLabel>Description</SectionLabel>
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="Purpose of this table, what it stores, key invariants…"
            onOpenEntity={onOpenEntity}
          />
        </div>

        <div className="mt-10">
          <div className="flex items-center gap-2 mb-2">
            <SectionLabel>Columns</SectionLabel>
            <span className="flex-1" />
            <button
              onClick={addColumn}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
              style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}
            >
              <Plus size={11} /> add column
            </button>
          </div>
          {draft.columns.length === 0 && (
            <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
              No columns defined yet.
            </div>
          )}
          {draft.columns.length > 0 && (
            <div
              className="rounded-md overflow-x-auto"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
            >
              <div style={{ minWidth: 860 }}>
                <div
                  className="grid gap-2 px-3 py-1.5 text-[10.5px] uppercase font-mono tracking-wider"
                  style={{
                    gridTemplateColumns:
                      'minmax(0,1.4fr) minmax(0,1fr) 52px 52px 52px minmax(0,2fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,1.8fr) 24px',
                    color: 'var(--c-subtle)',
                    borderBottom: '1px solid var(--c-hair)',
                  }}
                >
                  <span>name</span>
                  <span>type</span>
                  <span title="nullable">null?</span>
                  <span>uniq</span>
                  <span>pk</span>
                  <span>fk (table.column)</span>
                  <span>default</span>
                  <span>enumValues</span>
                  <span>description</span>
                  <span />
                </div>
                {draft.columns.map((c, i) => (
                  <ColumnRow
                    key={i}
                    column={c}
                    known={knownTableSlugs}
                    isLast={i === draft.columns.length - 1}
                    onChange={(partial) => updateColumn(i, partial)}
                    onRemove={() => removeColumn(i)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-10">
          <div className="flex items-center gap-2 mb-2">
            <SectionLabel>Indexes</SectionLabel>
            <span className="flex-1" />
            <button
              onClick={addIndex}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
              style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}
            >
              <Plus size={11} /> add index
            </button>
          </div>
          {draft.indexes.length === 0 && (
            <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
              No indexes defined.
            </div>
          )}
          {draft.indexes.length > 0 && (
            <div
              className="rounded-md"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
            >
              <div
                className="grid gap-2 px-3 py-1.5 text-[10.5px] uppercase font-mono tracking-wider"
                style={{
                  gridTemplateColumns: '2fr 1.4fr 60px 24px',
                  color: 'var(--c-subtle)',
                  borderBottom: '1px solid var(--c-hair)',
                }}
              >
                <span>columns (csv)</span>
                <span>name</span>
                <span>uniq</span>
                <span />
              </div>
              {draft.indexes.map((ix, i) => (
                <div
                  key={i}
                  className="grid gap-2 px-3 py-1.5 items-center"
                  style={{
                    gridTemplateColumns: '2fr 1.4fr 60px 24px',
                    borderBottom:
                      i === draft.indexes.length - 1 ? 'none' : '1px solid var(--c-hair)',
                  }}
                >
                  <input
                    value={ix.columns.join(',')}
                    onChange={(e) =>
                      updateIndex(i, {
                        columns: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="font-mono text-[12.5px] bg-transparent outline-none"
                    style={{ color: 'var(--c-ink)' }}
                    placeholder="col_a,col_b"
                    spellCheck={false}
                  />
                  <input
                    value={ix.name ?? ''}
                    onChange={(e) => updateIndex(i, { name: e.target.value || undefined })}
                    className="font-mono text-[12.5px] bg-transparent outline-none"
                    style={{ color: 'var(--c-muted)' }}
                    placeholder="idx_…"
                    spellCheck={false}
                  />
                  <input
                    type="checkbox"
                    checked={Boolean(ix.unique)}
                    onChange={(e) => updateIndex(i, { unique: e.target.checked })}
                  />
                  <button
                    onClick={() => removeIndex(i)}
                    className="text-[12px]"
                    style={{ color: 'var(--c-subtle)' }}
                    title="Remove index"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10">
          <SectionLabel>Find references</SectionLabel>
          {refs.length === 0 ? (
            <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
              Not referenced by any page.
            </div>
          ) : (
            <ul
              className="rounded-md"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
            >
              {refs.map((r, i) => (
                <li
                  key={`${r.pagePath}:${r.line}:${i}`}
                  className="px-3 py-1.5 text-[12.5px] flex items-center gap-2"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--c-hair)' }}
                >
                  <button
                    onClick={() => onOpenPage?.(r.pagePath)}
                    className="font-mono text-left hover:underline"
                    style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}
                  >
                    {r.pagePath}
                  </button>
                  <span className="text-[10.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
                    :{r.line}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[10.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
                    {r.tagType}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ColumnRow({
  column,
  known,
  isLast,
  onChange,
  onRemove,
}: {
  column: DatabaseTableColumn;
  known: Set<string>;
  isLast: boolean;
  onChange: (partial: Partial<DatabaseTableColumn>) => void;
  onRemove: () => void;
}) {
  const fkTable = column.fk?.table ?? '';
  const fkColumn = column.fk?.column ?? '';
  const fkUnknown = fkTable !== '' && !known.has(fkTable);
  const isEnum = column.type === 'enum';

  return (
    <div
      className="grid gap-2 px-3 py-1.5 items-center"
      style={{
        gridTemplateColumns:
          'minmax(0,1.4fr) minmax(0,1fr) 52px 52px 52px minmax(0,2fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,1.8fr) 24px',
        borderBottom: isLast ? 'none' : '1px solid var(--c-hair)',
      }}
    >
      <div className="flex items-center gap-1 min-w-0">
        {column.pk && (
          <Key
            size={10}
            style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}
            aria-label="primary key"
          />
        )}
        <input
          value={column.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="font-mono text-[12.5px] bg-transparent outline-none flex-1 min-w-0"
          style={{ color: 'var(--c-ink)' }}
          placeholder="col_name"
          spellCheck={false}
        />
      </div>
      <input
        list="database-column-types"
        value={column.type}
        onChange={(e) => onChange({ type: e.target.value })}
        className="font-mono text-[12.5px] bg-transparent outline-none min-w-0"
        style={{ color: 'var(--c-muted)' }}
        placeholder="string"
        spellCheck={false}
      />
      <input
        type="checkbox"
        checked={column.nullable !== false}
        onChange={(e) => onChange({ nullable: e.target.checked })}
        title="nullable"
      />
      <input
        type="checkbox"
        checked={Boolean(column.unique)}
        onChange={(e) => onChange({ unique: e.target.checked })}
        title="unique"
      />
      <input
        type="checkbox"
        checked={Boolean(column.pk)}
        onChange={(e) => onChange({ pk: e.target.checked })}
        title="primary key"
      />
      <div className="flex items-center gap-1 min-w-0">
        <input
          list="database-table-slugs"
          value={fkTable}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (!t) {
              const { fk: _discard, ...rest } = column;
              void _discard;
              onChange({ ...rest, fk: undefined } as Partial<DatabaseTableColumn>);
            } else {
              onChange({ fk: { table: t, column: fkColumn } });
            }
          }}
          className="font-mono text-[11.5px] bg-transparent outline-none flex-1 min-w-0"
          style={{
            color: fkUnknown ? 'var(--c-red, #c45a3b)' : 'var(--c-muted)',
          }}
          placeholder="table"
          spellCheck={false}
        />
        <span style={{ color: 'var(--c-subtle)' }}>.</span>
        <input
          value={fkColumn}
          onChange={(e) => {
            const col = e.target.value.trim();
            if (!fkTable && !col) return;
            onChange({ fk: { table: fkTable, column: col } });
          }}
          className="font-mono text-[11.5px] bg-transparent outline-none flex-1 min-w-0"
          style={{ color: 'var(--c-muted)' }}
          placeholder="column"
          spellCheck={false}
        />
        {fkUnknown && (
          <AlertTriangle
            size={11}
            style={{ color: 'var(--c-red, #c45a3b)' }}
            aria-label="fk target not found"
          />
        )}
      </div>
      <input
        value={column.default ?? ''}
        onChange={(e) => onChange({ default: e.target.value || undefined })}
        className="font-mono text-[11.5px] bg-transparent outline-none min-w-0"
        style={{ color: 'var(--c-muted)' }}
        placeholder="NULL"
        spellCheck={false}
      />
      <input
        value={(column.enumValues ?? []).join(',')}
        onChange={(e) => {
          const vals = e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          onChange({ enumValues: vals.length ? vals : undefined });
        }}
        className="font-mono text-[11.5px] bg-transparent outline-none min-w-0"
        style={{ color: isEnum ? 'var(--c-muted)' : 'var(--c-subtle)' }}
        placeholder={isEnum ? 'a,b,c' : '(enum only)'}
        spellCheck={false}
      />
      <input
        value={column.description ?? ''}
        onChange={(e) => onChange({ description: e.target.value || undefined })}
        className="text-[12px] bg-transparent outline-none min-w-0"
        style={{ color: 'var(--c-muted)' }}
        placeholder="column description"
      />
      <button
        onClick={onRemove}
        className="text-[12px]"
        style={{ color: 'var(--c-subtle)' }}
        title="Remove column"
      >
        ×
      </button>
      <datalist id="database-column-types">
        {SUGGESTED_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] uppercase font-mono tracking-wider mb-2"
      style={{ color: 'var(--c-subtle)' }}
    >
      {children}
    </div>
  );
}
