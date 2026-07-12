import { useMemo, useState } from 'react';
import { AlertTriangle, Monitor, Plus, Trash } from 'lucide-react';
import { DocEditor } from '../../host-ui-kit/detail/DocEditor.js';
import { TagPicker } from '../../host-ui-kit/detail/TagPicker.js';
import { FieldGrid } from '../../host-ui-kit/core/FieldGrid.js';
import { FieldRow } from '../../host-ui-kit/core/FieldRow.js';
import { ActionButton } from '../../host-ui-kit/actions/ActionButton.js';
import { useEntityDraftEditor } from '../_shared/useEntityDraftEditor.js';
import {
  useDeleteUiView,
  useUiView,
  useUiViews,
  useUpdateUiView,
} from '../../hooks/useUiViews.js';
import { useDesignSystems } from '../../hooks/useDesignSystems.js';
import { useTags } from '../../hooks/useTags.js';
import { useReferences } from '../../hooks/useReferences.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { tagSlug } from '../../../shared/slug.js';
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
  onOpenPage?: (rootId: string, path: string) => void;
}

interface Draft {
  name: string;
  url: string;
  description: string;
  params: UiViewParam[];
  designSystemSlug: string | null;
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
    designSystemSlug: v.designSystemSlug,
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
  const { data: designSystems = [] } = useDesignSystems();
  const { data: refs = [] } = useReferences('ui-view', view?.slug ?? null);

  const [warnings, setWarnings] = useState<string[]>([]);

  const { draft, dirty, patch } = useEntityDraftEditor({
    entity: view,
    toDraft,
    save: async (current, v) => {
      const updated = await update.mutateAsync({
        slug: v.slug,
        input: {
          name: current.name,
          url: current.url.trim() ? current.url.trim() : null,
          description: current.description || null,
          params: current.params,
          designSystemSlug: current.designSystemSlug,
          tags: current.tags,
        },
      });
      setWarnings(updated.warnings ?? []);
      if (updated.slug !== v.slug) onRenamed(updated.slug);
      return updated;
    },
  });

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

  function handleCreateTag(name: string) {
    if (!draft) return;
    const slug = tagSlug(name);
    if (!slug || draft.tags.includes(slug)) return;
    patch({ tags: [...draft.tags, slug] });
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
      <FieldGrid>
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

        <FieldRow label="URL">
          <input
            value={draft.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="/users/:id (empty = modal/drawer)"
            spellCheck={false}
            className="w-full font-mono text-[13.5px] bg-transparent outline-none px-2 py-1 rounded"
            style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
          />
        </FieldRow>

        <FieldRow label="Design System">
          <DesignSystemSelect
            value={draft.designSystemSlug}
            options={designSystems.map((d) => ({ slug: d.slug, name: d.name }))}
            onChange={(next) => patch({ designSystemSlug: next })}
            onOpen={onOpenEntity ? (s) => onOpenEntity('design-system', s) : undefined}
          />
        </FieldRow>

        <FieldRow label="Tags">
          <TagPicker
            allTags={allTags}
            selected={draft.tags}
            onToggle={toggleTag}
            onCreate={handleCreateTag}
            variant="collapsed"
          />
        </FieldRow>

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

        <FieldRow label="Description" align="start">
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="What this screen does, when it appears, key invariants…"
          />
        </FieldRow>

        <FieldRow label="Parameters" align="start">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex-1" />
            <ActionButton label="add parameter" icon={<Plus size={11} />} variant="secondary" onClick={addParam} />
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
        </FieldRow>

        <datalist id="ui-view-param-types">
          {SUGGESTED_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <FieldRow label="Find references" align="start">
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
                    onClick={() => onOpenPage?.(r.rootId, r.pagePath)}
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
        </FieldRow>
        {/* allViews datalist suppress unused */}
        {allViews.length === 0 && null}
      </FieldGrid>
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

/**
 * Single-select for the ui-view → design-system relation. Shows "None" + the
 * available systems. A value that no longer resolves renders as a red broken
 * chip with a clear action (the column is kept on the server; clearing is opt-in).
 */
function DesignSystemSelect({
  value,
  options,
  onChange,
  onOpen,
}: {
  value: string | null;
  options: Array<{ slug: string; name: string }>;
  onChange: (next: string | null) => void;
  onOpen?: (slug: string) => void;
}) {
  const resolved = value ? options.find((o) => o.slug === value) : null;
  const dangling = Boolean(value) && !resolved;
  return (
    <div className="flex items-center gap-2">
      <select
        value={dangling ? '' : value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="font-mono text-[12.5px] bg-transparent outline-none px-2 py-1 rounded"
        style={{ color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
      >
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
        {dangling && (
          <option value={value as string} disabled>
            {value} (missing)
          </option>
        )}
      </select>
      {resolved && onOpen && (
        <button
          onClick={() => onOpen(resolved.slug)}
          className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] text-[11px]"
          style={{ border: '1px solid var(--c-hair)', background: 'var(--c-card)', color: 'var(--c-ink)' }}
          title="Open design system"
        >
          <span
            className="font-mono text-[9.5px] px-1 rounded uppercase"
            style={{ background: 'var(--c-panel)', color: 'var(--c-accent)' }}
          >
            DS
          </span>
          {resolved.name}
        </button>
      )}
      {dangling && (
        <span
          className="inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] text-[11px] font-mono"
          style={{
            background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
            color: 'var(--c-red, #c45a3b)',
            border: '1px solid var(--c-red, #c45a3b)',
          }}
        >
          ⚠ {value}
          <button onClick={() => onChange(null)} title="Clear broken reference" style={{ color: 'inherit' }}>
            ×
          </button>
        </span>
      )}
    </div>
  );
}
