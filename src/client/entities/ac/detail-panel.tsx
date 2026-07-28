import { useLayoutEffect, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Trash, CheckSquare } from 'lucide-react';
import { Badge } from '../../host-ui-kit/actions/Badge.js';
import { EnumBadgePicker } from '../../host-ui-kit/pickers/EnumBadgePicker.js';
import { GroupedRelationPicker } from '../../host-ui-kit/pickers/GroupedRelationPicker.js';
import { DocEditor } from '../../host-ui-kit/detail/DocEditor.js';
import { TagPicker } from '../../host-ui-kit/detail/TagPicker.js';
import { FieldGrid } from '../../host-ui-kit/core/FieldGrid.js';
import { FieldRow } from '../../host-ui-kit/core/FieldRow.js';
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

/** `kind` and `status` are the catalog's colored-badge-with-dropdown, not bespoke widgets. */
const AC_KIND_OPTIONS = [
  { value: 'requirement', label: 'requirement', color: 'var(--c-accent)' },
  { value: 'edge-case', label: 'edge-case', color: 'var(--c-yellow-ink)' },
];

const AC_STATUS_OPTIONS = [
  { value: 'active', label: 'active', color: 'var(--c-accent)' },
  { value: 'deprecated', label: 'deprecated', color: 'var(--c-red, #c45a3b)' },
];

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
          <EnumBadgePicker
            options={AC_KIND_OPTIONS}
            value={draft.kind}
            onChange={(v) => patch({ kind: v as AcKind })}
          />
        </FieldRow>

        <FieldRow label="Status">
          <EnumBadgePicker
            options={AC_STATUS_OPTIONS}
            value={draft.status}
            onChange={(v) => patch({ status: v as AcStatus })}
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

        <div className="mt-6">
          <FieldRow label="Verifies" align="start">
            <VerifiesPanel
              verifies={draft.verifies}
              brokenByKey={brokenByKey}
              onAdd={addVerify}
              onRemove={removeVerify}
              onOpenEntity={onOpenEntity}
            />
          </FieldRow>
        </div>

        <div className="mt-6">
          <FieldRow label="Description" align="start">
            <DocEditor
              value={draft.description}
              onChange={(md) => patch({ description: md })}
              placeholder="Optional context: why this AC matters, how it's tested, related modules…"
            />
          </FieldRow>
        </div>

        <div className="mt-6">
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
        </div>
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

/**
 * `verifies` through the catalog's `GroupedRelationPicker`: one group per
 * verified entity type, chips per linked slug, dangling ones as a `broken`
 * `Badge`. Props-in — the actual link/unlink is a draft mutation above.
 *
 * The search box doubles as free-text entry: an AC may legitimately verify an
 * entity that doesn't exist yet, so a query matching nothing is offered as a
 * literal slug rather than being dropped. That preserved the one capability the
 * old hand-rolled panel had that a fixed candidate list would have removed.
 */
function VerifiesPanel({
  verifies,
  brokenByKey,
  onAdd,
  onRemove,
  onOpenEntity,
}: VerifiesPanelProps) {
  const [query, setQuery] = useState('');
  const modules = clientPluginHost.listEntities().filter((m) => m.type !== 'ac');

  const candidates = useQueries({
    queries: modules.map((m) => ({
      queryKey: ['verify-candidates', m.type] as const,
      queryFn: () => m.listByTags({ tags: [], filter: 'or' as const }),
      staleTime: 60_000,
    })),
  });

  const selected: Record<string, string[]> = {};
  for (const v of verifies) (selected[v.type] ??= []).push(v.slug);

  const q = query.trim().toLowerCase();
  const groups = modules.map((m, i) => {
    const linked = selected[m.type] ?? [];
    const fetched = (candidates[i]?.data ?? []).map((e) => e.slug);
    // Linked slugs must stay in `items` even when they resolve to nothing —
    // otherwise a broken reference would render as a bare id with no badge.
    const known = Array.from(new Set([...fetched, ...linked]));
    const matching = q ? known.filter((s) => s.toLowerCase().includes(q)) : known;
    const literal = q && !known.some((s) => s.toLowerCase() === q) ? [query.trim()] : [];

    return {
      key: m.type,
      label: m.label,
      items: [...matching, ...literal].map((slug) => {
        const reason = brokenByKey.get(`${m.type}/${slug}`);
        return {
          id: slug,
          label: slug,
          // The chip's own slot carries both the dangling marker and the
          // jump-to-entity affordance the old panel had on the slug itself.
          badge: (
            <>
              {reason && <Badge label={reason} variant="broken" small dot={false} />}
              {!reason && onOpenEntity && (
                <button
                  onClick={() => onOpenEntity(m.type as EntityType, slug)}
                  title={`Open ${m.type} ${slug}`}
                  className="opacity-70 hover:opacity-100 text-[11px]"
                  style={{ color: 'var(--c-accent)' }}
                >
                  ↗
                </button>
              )}
            </>
          ),
        };
      }),
    };
  });

  return (
    <GroupedRelationPicker
      groups={groups}
      selected={selected}
      onAdd={(groupKey, id) => {
        onAdd(groupKey, id);
        setQuery('');
      }}
      onRemove={(groupKey, id) => {
        const idx = verifies.findIndex((v) => v.type === groupKey && v.slug === id);
        if (idx >= 0) onRemove(idx);
      }}
      onSearch={setQuery}
    />
  );
}
