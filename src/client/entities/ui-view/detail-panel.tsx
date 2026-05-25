import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Monitor, Plus, Trash } from 'lucide-react';
import { TagChip } from '../../components/atoms.js';
import { DocEditor } from '../../components/DocEditor.js';
import {
  useDeleteUiView,
  useUiView,
  useUiViews,
  useUpdateUiView,
} from '../../hooks/useUiViews.js';
import { useTags } from '../../hooks/useTags.js';
import { useReferences } from '../../hooks/useReferences.js';
import { confirmDestructive, openPopover, toast } from '../../ui/events.js';
import type {
  EntityType,
  UiView,
  UiViewParam,
  UiViewParamLocation,
} from '../../../shared/entities.js';

interface Props {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenPage?: (path: string) => void;
}

interface Draft {
  name: string;
  url: string;
  description: string;
  params: UiViewParam[];
  tags: string[];
}

const PARAM_ORDER: Record<UiViewParamLocation, number> = {
  path: 0,
  query: 1,
  hash: 2,
};

const SUGGESTED_TYPES = [
  'string',
  'int',
  'uuid',
  'boolean',
  'enum',
  'date',
  'timestamp',
];

const PATH_PARAM_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;

function toDraft(v: UiView): Draft {
  return {
    name: v.name,
    url: v.url ?? '',
    description: v.description ?? '',
    params: v.params,
    tags: v.tags,
  };
}

function urlPathParams(url: string): Set<string> {
  const out = new Set<string>();
  for (const m of url.matchAll(PATH_PARAM_RE)) out.add(m[1]!);
  return out;
}

function paramHasIssue(p: UiViewParam, idx: number, all: UiViewParam[], url: string): string | null {
  if (!p.name) return 'missing name';
  if (!['path', 'query', 'hash'].includes(p.in)) return 'invalid `in`';
  if (p.in === 'path' && url) {
    if (!urlPathParams(url).has(p.name)) return `not present in URL`;
  }
  if (p.in === 'path' && !url) return 'URL is null';
  const dupIdx = all.findIndex(
    (q, i) => i !== idx && q.name === p.name && q.in === p.in
  );
  if (dupIdx !== -1) return 'duplicate (name, in)';
  return null;
}

export function UiViewDetail({
  slug,
  onDeleted,
  onRenamed,
  onOpenEntity,
  onOpenPage,
}: Props) {
  const { data: view, isLoading, error } = useUiView(slug);
  const update = useUpdateUiView();
  const remove = useDeleteUiView();
  const { data: allTags = [] } = useTags();
  const { data: allViews = [] } = useUiViews();
  const { data: refs = [] } = useReferences('ui-view', view?.slug ?? null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const baselineRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!view) return;
    const next = toDraft(view);
    const snapshot = JSON.stringify(next);
    if (baselineRef.current === snapshot) return;
    baselineRef.current = snapshot;
    setDraft(next);
  }, [view]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    []
  );

  const dirty = useMemo(() => {
    if (!draft || !view) return false;
    return JSON.stringify(draft) !== baselineRef.current;
  }, [draft, view]);

  function scheduleAutosave(next: Draft) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void runSave(next), 500);
  }

  async function runSave(current: Draft) {
    if (!view) return;
    try {
      const updated = await update.mutateAsync({
        slug: view.slug,
        input: {
          name: current.name,
          url: current.url.trim() ? current.url.trim() : null,
          description: current.description || null,
          params: current.params,
          tags: current.tags,
        },
      });
      baselineRef.current = JSON.stringify(toDraft(updated));
      setWarnings(updated.warnings ?? []);
      if (updated.slug !== view.slug) onRenamed(updated.slug);
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
    if (!view) return;
    const refCount = refs.length;
    const body = refCount
      ? `Delete UI view "${view.name}"? ${refCount} page${refCount === 1 ? '' : 's'} reference this view and will become broken.`
      : `Delete UI view "${view.name}"? This cannot be undone.`;
    const ok = await confirmDestructive({
      title: 'Delete UI view?',
      body,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(view.slug);
      onDeleted();
      toast.success(`View ${view.name} deleted`);
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
      { contextLabel: view?.name }
    );
    if (!result) return;
    const tslug = result.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!tslug || draft.tags.includes(tslug)) return;
    patch({ tags: [...draft.tags, tslug] });
  }

  function updateParam(index: number, partial: Partial<UiViewParam>) {
    if (!draft) return;
    const params = draft.params.map((p, i) => (i === index ? { ...p, ...partial } : p));
    patch({ params });
  }

  function removeParam(index: number) {
    if (!draft) return;
    patch({ params: draft.params.filter((_, i) => i !== index) });
  }

  function addParam() {
    if (!draft) return;
    patch({ params: [...draft.params, { name: '', in: 'query' }] });
  }

  const sortedParams = useMemo(() => {
    if (!draft) return [];
    return draft.params
      .map((p, idx) => ({ p, idx }))
      .sort((a, b) => (PARAM_ORDER[a.p.in] ?? 9) - (PARAM_ORDER[b.p.in] ?? 9));
  }, [draft]);

  if (isLoading && !view) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading UI view…
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
  if (!view || !draft) return null;

  const declaredPathSet = new Set(
    draft.params.filter((p) => p.in === 'path' && p.name).map((p) => p.name)
  );
  const urlPathSet = urlPathParams(draft.url);
  const missingFromParams = [...urlPathSet].filter((n) => !declaredPathSet.has(n));

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 960, padding: '48px 56px 140px' }}>
        <div
          className="flex items-center gap-2 mb-1 text-[11px]"
          style={{ color: 'var(--c-subtle)' }}
        >
          <span className="font-mono">{view.slug}</span>
          <span>·</span>
          <span>
            updated{' '}
            {new Date(view.updatedAt.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
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
            onClick={handleDelete}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
            style={{ color: 'var(--c-red, #c45a3b)' }}
            title="Delete"
          >
            <Trash size={11} /> Delete
          </button>
        </div>

        <div className="flex items-center gap-2 mt-2 mb-1">
          <Monitor size={22} style={{ color: 'var(--c-accent)' }} />
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="flex-1 bg-transparent outline-none"
            style={{ fontSize: 26, fontWeight: 600, color: 'var(--c-ink)' }}
            placeholder="Screen Name"
            spellCheck={false}
          />
        </div>

        <div className="flex items-center gap-2 mt-2">
          <span
            className="text-[10.5px] uppercase font-mono tracking-wider"
            style={{ color: 'var(--c-subtle)' }}
          >
            URL
          </span>
          <input
            value={draft.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="/users/:id (empty = modal/drawer)"
            spellCheck={false}
            className="flex-1 font-mono text-[13.5px] bg-transparent outline-none px-2 py-1 rounded"
            style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
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
            placeholder="What this screen does, when it appears, key invariants…"
            onOpenEntity={onOpenEntity}
          />
        </div>

        <div className="mt-10">
          <div className="flex items-center gap-2 mb-2">
            <SectionLabel>Parameters</SectionLabel>
            <span className="flex-1" />
            <button
              onClick={addParam}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
              style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}
            >
              <Plus size={11} /> add parameter
            </button>
          </div>
          {missingFromParams.length > 0 && (
            <div
              className="mb-2 text-[11.5px] flex items-center gap-1.5"
              style={{ color: 'var(--c-yellow-ink, #c4a24f)' }}
            >
              <AlertTriangle size={11} />
              URL has path param{missingFromParams.length === 1 ? '' : 's'}{' '}
              {missingFromParams.map((n) => `:${n}`).join(', ')} not declared in params[].
            </div>
          )}
          {draft.params.length === 0 && (
            <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
              No parameters defined yet.
            </div>
          )}
          {draft.params.length > 0 && (
            <div
              className="rounded-md overflow-x-auto"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
            >
              <div style={{ minWidth: 760 }}>
                <div
                  className="grid gap-2 px-3 py-1.5 text-[10.5px] uppercase font-mono tracking-wider"
                  style={{
                    gridTemplateColumns: '1.4fr 0.8fr 1fr 60px 0.8fr 2fr 24px 24px',
                    color: 'var(--c-subtle)',
                    borderBottom: '1px solid var(--c-hair)',
                  }}
                >
                  <span>name</span>
                  <span>in</span>
                  <span>type</span>
                  <span>req</span>
                  <span>default</span>
                  <span>description</span>
                  <span />
                  <span />
                </div>
                {sortedParams.map(({ p, idx }) => {
                  const issue = paramHasIssue(p, idx, draft.params, draft.url);
                  return (
                    <ParamRow
                      key={idx}
                      param={p}
                      issue={issue}
                      onChange={(partial) => updateParam(idx, partial)}
                      onRemove={() => removeParam(idx)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <datalist id="ui-view-param-types">
          {SUGGESTED_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

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
        {/* allViews datalist suppress unused */}
        {allViews.length === 0 && null}
      </div>
    </div>
  );
}

function ParamRow({
  param,
  issue,
  onChange,
  onRemove,
}: {
  param: UiViewParam;
  issue: string | null;
  onChange: (partial: Partial<UiViewParam>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="grid gap-2 px-3 py-1.5 items-center"
      style={{
        gridTemplateColumns: '1.4fr 0.8fr 1fr 60px 0.8fr 2fr 24px 24px',
        borderBottom: '1px solid var(--c-hair)',
      }}
    >
      <input
        value={param.name}
        onChange={(e) => onChange({ name: e.target.value })}
        className="font-mono text-[12.5px] bg-transparent outline-none"
        style={{ color: 'var(--c-ink)' }}
        placeholder="param_name"
        spellCheck={false}
      />
      <select
        value={param.in}
        onChange={(e) => onChange({ in: e.target.value as UiViewParamLocation })}
        className="font-mono text-[12.5px] bg-transparent outline-none"
        style={{ color: 'var(--c-muted)' }}
      >
        <option value="path">path</option>
        <option value="query">query</option>
        <option value="hash">hash</option>
      </select>
      <input
        list="ui-view-param-types"
        value={param.type ?? ''}
        onChange={(e) => onChange({ type: e.target.value || undefined })}
        className="font-mono text-[12.5px] bg-transparent outline-none"
        style={{ color: 'var(--c-muted)' }}
        placeholder="string"
        spellCheck={false}
      />
      <input
        type="checkbox"
        checked={Boolean(param.required)}
        onChange={(e) => onChange({ required: e.target.checked })}
        title="required"
      />
      <input
        value={param.default ?? ''}
        onChange={(e) => onChange({ default: e.target.value || undefined })}
        className="font-mono text-[11.5px] bg-transparent outline-none"
        style={{ color: 'var(--c-muted)' }}
        placeholder="—"
        spellCheck={false}
      />
      <input
        value={param.description ?? ''}
        onChange={(e) => onChange({ description: e.target.value || undefined })}
        className="text-[12px] bg-transparent outline-none"
        style={{ color: 'var(--c-muted)' }}
        placeholder="optional description"
      />
      {issue ? (
        <AlertTriangle
          size={12}
          style={{ color: 'var(--c-yellow-ink, #c4a24f)' }}
          aria-label={`warning: ${issue}`}
        />
      ) : (
        <span />
      )}
      <button
        onClick={onRemove}
        className="text-[12px]"
        style={{ color: 'var(--c-subtle)' }}
        title="Remove parameter"
      >
        ×
      </button>
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
