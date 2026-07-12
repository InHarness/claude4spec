import { useMemo, useState } from 'react';
import { ChevronDown, Copy, GripVertical, Pencil, Plus, Trash, X } from 'lucide-react';
import type { DtoExample, DtoField } from '../../../shared/entities.js';
import { confirmDestructive } from '../../ui/events.js';
import { FieldRow } from '../../host-ui-kit/core/FieldRow.js';
import { MonacoJsonEditor } from './MonacoJsonEditor.js';
import { buildExampleTemplate, validateExampleAgainstFields } from './exampleValidation.js';

interface Props {
  examples: DtoExample[];
  fields: DtoField[];
  onChange: (next: DtoExample[]) => void;
}

interface RowState {
  expanded: boolean;
  editingMeta: boolean;
  editing: boolean;
  rawJson: string;
  parseError: string | null;
}

function defaultRowState(value: unknown): RowState {
  return {
    expanded: false,
    editingMeta: false,
    editing: false,
    rawJson: pretty(value),
    parseError: null,
  };
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

export function ExamplesPanel({ examples, fields, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftJson, setDraftJson] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const usedNames = useMemo(() => new Set(examples.map((e) => e.name)), [examples]);

  function rowState(i: number): RowState {
    return rows[i] ?? defaultRowState(examples[i]?.value);
  }

  function setRow(i: number, partial: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [i]: { ...rowState(i), ...partial } }));
  }

  function startAdd() {
    setAdding(true);
    setDraftName('');
    setDraftSummary('');
    setDraftJson(pretty(buildExampleTemplate(fields)));
    setDraftError(null);
  }

  function cancelAdd() {
    setAdding(false);
    setDraftError(null);
  }

  function submitAdd() {
    const name = draftName.trim();
    if (!name) {
      setDraftError('name is required');
      return;
    }
    if (usedNames.has(name)) {
      setDraftError(`example '${name}' already exists`);
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(draftJson || 'null');
    } catch (err) {
      setDraftError(`invalid JSON: ${(err as Error).message}`);
      return;
    }
    const next: DtoExample = {
      name,
      value,
      ...(draftSummary.trim() ? { summary: draftSummary.trim() } : {}),
    };
    onChange([...examples, next]);
    cancelAdd();
  }

  function updateExample(i: number, partial: Partial<DtoExample>) {
    onChange(examples.map((ex, idx) => (idx === i ? { ...ex, ...partial } : ex)));
  }

  function commitJsonEdit(i: number) {
    const st = rowState(i);
    let parsed: unknown;
    try {
      parsed = JSON.parse(st.rawJson || 'null');
    } catch (err) {
      setRow(i, { parseError: (err as Error).message });
      return;
    }
    setRow(i, { parseError: null, editing: false });
    updateExample(i, { value: parsed });
  }

  async function removeExample(i: number) {
    const ex = examples[i];
    if (!ex) return;
    const ok = await confirmDestructive({
      title: 'Delete example?',
      body: `Delete example '${ex.name}'?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const next = examples.filter((_, idx) => idx !== i);
    onChange(next);
    setRows((prev) => {
      const out: Record<number, RowState> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k);
        if (idx === i) return;
        out[idx > i ? idx - 1 : idx] = v;
      });
      return out;
    });
  }

  function duplicateExample(i: number) {
    const ex = examples[i];
    if (!ex) return;
    let suffix = 2;
    let candidate = `${ex.name}-copy`;
    while (usedNames.has(candidate)) {
      candidate = `${ex.name}-copy-${suffix++}`;
    }
    const next: DtoExample = {
      name: candidate,
      value: clone(ex.value),
      ...(ex.summary ? { summary: ex.summary } : {}),
    };
    onChange([...examples.slice(0, i + 1), next, ...examples.slice(i + 1)]);
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = examples.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
    setRows({});
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <SectionLabel>Examples</SectionLabel>
        <span className="flex-1" />
        {!adding && (
          <button
            onClick={startAdd}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
            style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}
          >
            <Plus size={11} /> add example
          </button>
        )}
      </div>

      {!adding && examples.length === 0 && (
        <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
          No examples yet. Add one to document a typical payload.
        </div>
      )}

      {adding && (
        <div
          className="rounded-md p-3 mb-2"
          style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
        >
          <div className="flex items-center mb-2">
            <span className="flex-1" />
            <button
              onClick={cancelAdd}
              className="text-[11px] px-2 py-0.5 rounded"
              style={{ color: 'var(--c-subtle)' }}
            >
              <X size={12} />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <FieldRow label="name">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.target.value);
                  if (draftError) setDraftError(null);
                }}
                className="font-mono text-[12.5px] bg-transparent outline-none w-full"
                style={{ color: 'var(--c-ink)' }}
                placeholder='name (e.g. "minimal")'
                spellCheck={false}
              />
            </FieldRow>
            <FieldRow label="summary">
              <input
                value={draftSummary}
                onChange={(e) => setDraftSummary(e.target.value)}
                className="text-[12.5px] bg-transparent outline-none w-full"
                style={{ color: 'var(--c-muted)' }}
                placeholder="summary (optional)"
              />
            </FieldRow>
            <FieldRow label="value" align="start">
              <MonacoJsonEditor value={draftJson} onChange={setDraftJson} height={200} />
              {draftError && (
                <div className="mt-1 text-[11px]" style={{ color: 'var(--c-red, #c45a3b)' }}>
                  {draftError}
                </div>
              )}
            </FieldRow>
          </div>
          <div className="flex justify-end mt-2">
            <button
              onClick={submitAdd}
              className="text-[12px] px-3 py-1 rounded"
              style={{
                background: 'var(--c-accent)',
                color: 'var(--c-paper, #fff)',
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {examples.length > 0 && (
        <div
          className="rounded-md"
          style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
        >
          {examples.map((ex, i) => {
            const st = rowState(i);
            const warnings = st.expanded ? validateExampleAgainstFields(ex.value, fields) : [];
            return (
              <div
                key={`${ex.name}-${i}`}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx !== null) reorder(dragIdx, i);
                  setDragIdx(null);
                }}
                style={{
                  borderBottom: i === examples.length - 1 ? 'none' : '1px solid var(--c-hair)',
                }}
              >
                <div
                  className="flex items-center gap-2 px-2 py-1.5"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setRow(i, { expanded: !st.expanded })}
                >
                  <GripVertical size={12} style={{ color: 'var(--c-subtle)', cursor: 'grab' }} />
                  <ChevronDown
                    size={12}
                    style={{
                      color: 'var(--c-subtle)',
                      transform: st.expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 80ms',
                    }}
                  />
                  {st.editingMeta ? (
                    <ExampleMetaEditor
                      example={ex}
                      otherNames={new Set([...usedNames].filter((n) => n !== ex.name))}
                      onCancel={(e) => {
                        e?.stopPropagation();
                        setRow(i, { editingMeta: false });
                      }}
                      onSave={(next, e) => {
                        e?.stopPropagation();
                        updateExample(i, next);
                        setRow(i, { editingMeta: false });
                      }}
                    />
                  ) : (
                    <>
                      <span
                        className="font-mono text-[12.5px]"
                        style={{ color: 'var(--c-ink)', minWidth: 96 }}
                      >
                        {ex.name}
                      </span>
                      <span
                        className="text-[12px] flex-1 truncate"
                        style={{ color: 'var(--c-subtle)' }}
                      >
                        {ex.summary ?? ''}
                      </span>
                    </>
                  )}
                  {!st.editingMeta && (
                    <RowActions
                      onEdit={(e) => {
                        e.stopPropagation();
                        setRow(i, { editingMeta: true, expanded: true });
                      }}
                      onDuplicate={(e) => {
                        e.stopPropagation();
                        duplicateExample(i);
                      }}
                      onDelete={(e) => {
                        e.stopPropagation();
                        void removeExample(i);
                      }}
                    />
                  )}
                </div>

                {st.expanded && (
                  <div className="px-2 pb-2">
                    <FieldRow align="start" label="value">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="flex-1" />
                        {!st.editing && (
                          <button
                            onClick={() => setRow(i, { editing: true, rawJson: pretty(ex.value), parseError: null })}
                            className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded"
                            style={{ color: 'var(--c-muted)' }}
                          >
                            <Pencil size={10} /> edit
                          </button>
                        )}
                        {st.editing && (
                          <>
                            <button
                              onClick={() =>
                                setRow(i, {
                                  editing: false,
                                  rawJson: pretty(ex.value),
                                  parseError: null,
                                })
                              }
                              className="text-[11px] px-1.5 py-0.5 rounded"
                              style={{ color: 'var(--c-subtle)' }}
                            >
                              cancel
                            </button>
                            <button
                              onClick={() => commitJsonEdit(i)}
                              className="text-[11px] px-2 py-0.5 rounded"
                              style={{ background: 'var(--c-accent)', color: 'var(--c-paper, #fff)' }}
                            >
                              save
                            </button>
                          </>
                        )}
                      </div>
                      <MonacoJsonEditor
                        value={st.editing ? st.rawJson : pretty(ex.value)}
                        onChange={(v) => setRow(i, { rawJson: v, parseError: null })}
                        readOnly={!st.editing}
                        height={220}
                      />
                      {st.parseError && (
                        <div className="mt-1 text-[11px]" style={{ color: 'var(--c-red, #c45a3b)' }}>
                          invalid JSON: {st.parseError}
                        </div>
                      )}
                      {!st.editing && warnings.length > 0 && (
                        <div
                          className="mt-1 text-[11px] px-2 py-1 rounded"
                          style={{
                            background: 'var(--c-warn-bg, #fdf6e3)',
                            color: 'var(--c-warn-ink, #8a6d3b)',
                            border: '1px solid var(--c-warn-border, #e7d9b3)',
                          }}
                        >
                          Example doesn't match fields:
                          {warnings.map((w) => (
                            <div key={w.field}>
                              <span className="font-mono">{w.field}</span>: expected {w.expected}, got {w.got}
                            </div>
                          ))}
                        </div>
                      )}
                    </FieldRow>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RowActions({
  onEdit,
  onDuplicate,
  onDelete,
}: {
  onEdit: (e: React.MouseEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onEdit}
        className="text-[11px] px-1.5 py-0.5 rounded"
        style={{ color: 'var(--c-subtle)' }}
        title="Edit name/summary"
      >
        <Pencil size={11} />
      </button>
      <button
        onClick={onDuplicate}
        className="text-[11px] px-1.5 py-0.5 rounded"
        style={{ color: 'var(--c-subtle)' }}
        title="Duplicate"
      >
        <Copy size={11} />
      </button>
      <button
        onClick={onDelete}
        className="text-[11px] px-1.5 py-0.5 rounded"
        style={{ color: 'var(--c-red, #c45a3b)' }}
        title="Delete"
      >
        <Trash size={11} />
      </button>
    </div>
  );
}

function ExampleMetaEditor({
  example,
  otherNames,
  onSave,
  onCancel,
}: {
  example: DtoExample;
  otherNames: Set<string>;
  onSave: (next: { name: string; summary?: string }, e?: React.MouseEvent) => void;
  onCancel: (e?: React.MouseEvent) => void;
}) {
  const [name, setName] = useState(example.name);
  const [summary, setSummary] = useState(example.summary ?? '');
  const [error, setError] = useState<string | null>(null);

  function commit(e: React.MouseEvent) {
    e.stopPropagation();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('name is required');
      return;
    }
    if (otherNames.has(trimmed)) {
      setError(`name '${trimmed}' already exists`);
      return;
    }
    onSave(
      {
        name: trimmed,
        ...(summary.trim() ? { summary: summary.trim() } : { summary: undefined }),
      },
      e,
    );
  }

  return (
    <>
      <input
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (error) setError(null);
        }}
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-[12.5px] bg-transparent outline-none"
        style={{ color: 'var(--c-ink)', minWidth: 96 }}
        spellCheck={false}
      />
      <input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="text-[12px] bg-transparent outline-none flex-1"
        style={{ color: 'var(--c-muted)' }}
        placeholder="summary (optional)"
      />
      {error && (
        <span className="text-[11px]" style={{ color: 'var(--c-red, #c45a3b)' }}>
          {error}
        </span>
      )}
      <button
        onClick={commit}
        className="text-[11px] px-2 py-0.5 rounded"
        style={{ background: 'var(--c-accent)', color: 'var(--c-paper, #fff)' }}
      >
        save
      </button>
      <button
        onClick={(e) => onCancel(e)}
        className="text-[11px] px-1.5 py-0.5 rounded"
        style={{ color: 'var(--c-subtle)' }}
      >
        <X size={11} />
      </button>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] uppercase font-mono tracking-wider"
      style={{ color: 'var(--c-subtle)' }}
    >
      {children}
    </div>
  );
}

function clone<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}
