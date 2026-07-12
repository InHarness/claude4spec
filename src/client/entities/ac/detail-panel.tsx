import { useLayoutEffect, useRef, useState } from 'react';
import { Plus, Trash, CheckSquare, X } from 'lucide-react';
import { DocEditor } from '../../host-ui-kit/detail/DocEditor.js';
import { TagPicker } from '../../host-ui-kit/detail/TagPicker.js';
import { FieldGrid } from '../../host-ui-kit/core/FieldGrid.js';
import { FieldRow } from '../../host-ui-kit/core/FieldRow.js';
import { ActionButton } from '../../host-ui-kit/actions/ActionButton.js';
import { useEntityDraftEditor } from '../_shared/useEntityDraftEditor.js';
import { useAc, useDeleteAc, useUpdateAc } from '../../hooks/useAcs.js';
import { useTags } from '../../hooks/useTags.js';
import { useReferences } from '../../hooks/useReferences.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { tagSlug } from '../../../shared/slug.js';
import type {
  Ac,
  AcKind,
  AcStatus,
  AcVerifyRef,
  EntityType,
} from '../../../shared/entities.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';

interface Props {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenPage?: (rootId: string, path: string) => void;
}

interface Draft {
  text: string;
  kind: AcKind;
  status: AcStatus;
  verifies: AcVerifyRef[];
  description: string;
  tags: string[];
}

function toDraft(ac: Ac): Draft {
  return {
    text: ac.text,
    kind: ac.kind,
    status: ac.status,
    verifies: ac.verifies,
    description: ac.description ?? '',
    tags: ac.tags,
  };
}

export function AcDetail({
  slug,
  onDeleted,
  onRenamed,
  onOpenEntity,
  onOpenPage,
}: Props) {
  const { data: ac, isLoading, error } = useAc(slug);
  const update = useUpdateAc();
  const remove = useDeleteAc();
  const { data: allTags = [] } = useTags();
  const { data: refs = [] } = useReferences('ac', ac?.slug ?? null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { draft, dirty, patch } = useEntityDraftEditor({
    entity: ac,
    toDraft,
    save: async (current, a) => {
      const updated = await update.mutateAsync({
        slug: a.slug,
        input: {
          text: current.text,
          kind: current.kind,
          status: current.status,
          verifies: current.verifies,
          description: current.description || null,
          tags: current.tags,
        },
      });
      if (updated.slug !== a.slug) onRenamed(updated.slug);
      return updated;
    },
  });

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft?.text]);

  async function handleDelete() {
    if (!ac) return;
    const ok = await confirmDestructive({
      title: 'Delete AC?',
      body: `Delete this acceptance criterion? Prefer marking it as deprecated to keep history.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(ac.slug);
      onDeleted();
      toast.success('AC deleted');
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

  function addVerify(refType: string, refSlug: string) {
    if (!draft) return;
    const exists = draft.verifies.some((v) => v.type === refType && v.slug === refSlug);
    if (exists) return;
    patch({ verifies: [...draft.verifies, { type: refType, slug: refSlug }] });
  }

  function removeVerify(idx: number) {
    if (!draft) return;
    patch({ verifies: draft.verifies.filter((_, i) => i !== idx) });
  }

  if (isLoading && !ac) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading AC…
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
  if (!ac || !draft) return null;

  const brokenByKey = new Map<string, string>();
  for (const b of ac.brokenVerifies ?? []) {
    brokenByKey.set(`${b.type}/${b.slug}`, b.reason);
  }
  const deprecated = draft.status === 'deprecated';

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <FieldGrid maxWidth={740}>
        <div className="flex items-center gap-2 mb-1 text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          <span className="font-mono">{ac.slug}</span>
          <span>·</span>
          <span>
            updated{' '}
            {new Date(ac.updatedAt.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
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

        <div className="flex items-start gap-2 mt-2 mb-1">
          <CheckSquare size={22} style={{ color: 'var(--c-accent)', marginTop: 6 }} />
          <textarea
            ref={textareaRef}
            value={draft.text}
            onChange={(e) => patch({ text: e.target.value })}
            rows={1}
            className="flex-1 bg-transparent outline-none resize-none overflow-hidden"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--c-ink)',
              textDecoration: deprecated ? 'line-through' : undefined,
            }}
            placeholder="Observable behavior asserted by this AC…"
            spellCheck={false}
          />
        </div>

        <FieldRow label="Kind">
          <div className="flex items-center gap-3 flex-wrap text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={draft.kind === 'requirement'}
                onChange={() => patch({ kind: 'requirement' })}
              />
              requirement
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={draft.kind === 'edge-case'}
                onChange={() => patch({ kind: 'edge-case' })}
              />
              edge-case
            </label>
          </div>
        </FieldRow>

        <FieldRow label="Status">
          <button
            onClick={() => patch({ status: deprecated ? 'active' : 'deprecated' })}
            className="rounded-full px-2 py-0.5 text-[10.5px] uppercase font-mono tracking-wider"
            style={{
              background: deprecated ? 'var(--c-panel)' : 'transparent',
              color: deprecated ? 'var(--c-red, #c45a3b)' : 'var(--c-subtle)',
              border: `1px solid ${deprecated ? 'var(--c-red, #c45a3b)' : 'var(--c-hair-strong)'}`,
            }}
            title={deprecated ? 'Click to reactivate' : 'Click to mark deprecated'}
          >
            {deprecated ? 'deprecated' : 'active'}
          </button>
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

        <FieldRow label="Verifies" align="start">
          <VerifiesPanel
            verifies={draft.verifies}
            brokenByKey={brokenByKey}
            onAdd={addVerify}
            onRemove={removeVerify}
            onOpenEntity={onOpenEntity}
          />
        </FieldRow>

        <FieldRow label="Description" align="start">
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="Optional context: why this AC matters, how it's tested, related modules…"
          />
        </FieldRow>

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
      </FieldGrid>
    </div>
  );
}

interface VerifiesPanelProps {
  verifies: AcVerifyRef[];
  brokenByKey: Map<string, string>;
  onAdd: (type: string, slug: string) => void;
  onRemove: (idx: number) => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
}

function VerifiesPanel({ verifies, brokenByKey, onAdd, onRemove, onOpenEntity }: VerifiesPanelProps) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<string>('endpoint');
  const [slugInput, setSlugInput] = useState('');

  const availableTypes = clientPluginHost.listEntities()
    .filter((m) => m.type !== 'ac')
    .map((m) => ({ type: m.type, label: m.label }));

  function commit() {
    const trimmed = slugInput.trim();
    if (!trimmed) return;
    onAdd(type, trimmed);
    setSlugInput('');
    setAdding(false);
  }

  return (
    <div
      className="rounded-md"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
    >
      {verifies.length === 0 && !adding && (
        <div className="px-3 py-3 text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
          No entity references yet.
        </div>
      )}
      {verifies.map((v, i) => {
        const key = `${v.type}/${v.slug}`;
        const reason = brokenByKey.get(key);
        return (
          <div
            key={`${key}-${i}`}
            className="px-3 py-1.5 text-[12.5px] flex items-center gap-2"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--c-hair)' }}
          >
            <span
              className="text-[10.5px] uppercase font-mono tracking-wider"
              style={{ color: 'var(--c-subtle)', minWidth: 86 }}
            >
              {v.type}
            </span>
            <button
              onClick={() => onOpenEntity?.(v.type as EntityType, v.slug)}
              className="font-mono hover:underline"
              style={{ color: reason ? 'var(--c-red, #c45a3b)' : 'var(--c-accent-ink, var(--c-accent))' }}
              title={reason ? `Broken: ${reason}` : `Open ${v.type} ${v.slug}`}
            >
              {reason ? `⚠ ${v.slug}` : v.slug}
            </button>
            {reason && (
              <span
                className="text-[10.5px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: 'var(--c-panel)', color: 'var(--c-red, #c45a3b)' }}
              >
                {reason}
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={() => onRemove(i)}
              className="text-[12px]"
              style={{ color: 'var(--c-subtle)' }}
              title="Remove reference"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      {adding ? (
        <div
          className="px-3 py-2 flex items-center gap-2"
          style={{ borderTop: verifies.length > 0 ? '1px solid var(--c-hair)' : 'none' }}
        >
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="text-[12px] rounded px-1.5 py-1 bg-transparent outline-none"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          >
            {availableTypes.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            autoFocus
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="entity slug"
            className="flex-1 text-[12.5px] rounded px-1.5 py-1 bg-transparent outline-none font-mono"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          />
          <ActionButton label="Add" variant="primary" onClick={commit} />
          <ActionButton label="Cancel" variant="ghost" onClick={() => setAdding(false)} />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full px-3 py-1.5 text-left text-[12px] inline-flex items-center gap-1"
          style={{
            color: 'var(--c-subtle)',
            borderTop: verifies.length > 0 ? '1px solid var(--c-hair)' : 'none',
          }}
        >
          <Plus size={11} /> add entity reference
        </button>
      )}
    </div>
  );
}
