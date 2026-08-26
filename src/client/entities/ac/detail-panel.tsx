import { useLayoutEffect, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Trash, CheckSquare } from 'lucide-react';
import { Badge } from '../../host-ui-kit/actions/Badge.js';
import { EnumBadgePicker } from '../../host-ui-kit/pickers/EnumBadgePicker.js';
import { GroupedRelationPicker } from '../../host-ui-kit/pickers/GroupedRelationPicker.js';
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
import { verifyGroupItems, verifyGroupTypes } from './verify-groups.js';

/** `kind` and `status` are the catalog's colored-badge-with-dropdown, not bespoke widgets. */
const AC_KIND_OPTIONS = [
  { value: 'requirement', label: 'requirement', color: 'var(--c-accent)' },
  { value: 'edge-case', label: 'edge-case', color: 'var(--c-yellow-ink)' },
];

/** `title`'s bound in `acData`, enforced in the browser too so the 501st character never gets typed. */
const AC_TITLE_MAX_LENGTH = 500;

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

/**
 * 0.2.51 — one prose field, and it is the reserved one.
 *
 * The draft used to carry `text` (the criterion) and `description` (optional
 * prose beside it) while `title` — the field the chip, the row, the card, the
 * slug and every identity lookup actually read — was absent, auto-derived, and
 * unreachable from this page. Editing the H1 therefore changed a field nothing
 * displayed. Now the H1 edits `title` itself, and there is nothing else to edit.
 */
interface Draft {
  title: string;
  kind: AcKind;
  status: AcStatus;
  verifies: AcVerifyRef[];
  tags: string[];
}

function toDraft(ac: Ac): Draft {
  return {
    title: ac.title,
    kind: ac.kind,
    status: ac.status,
    verifies: ac.verifies,
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
          title: current.title,
          kind: current.kind,
          status: current.status,
          verifies: current.verifies,
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
  }, [draft?.title]);

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
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            rows={1}
            maxLength={AC_TITLE_MAX_LENGTH}
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
        {/* The detail page is where the criterion is NOT abbreviated — the chip
            and the row cut to 40 characters, this shows all 500 and grows to
            fit them. */}

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
              onAdd={addVerify}
              onRemove={removeVerify}
              onOpenEntity={onOpenEntity}
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
  onAdd: (type: string, slug: string) => void;
  onRemove: (idx: number) => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
}

/**
 * `verifies` through the catalog's `GroupedRelationPicker`: one group per
 * verified entity type, chips per linked slug, dangling ones as a `broken`
 * `Badge`. Props-in — the actual link/unlink is a draft mutation above.
 *
 * Each group's search box doubles as free-text entry: an AC may legitimately
 * verify an entity that does not exist yet, so a query matching nothing is
 * offered as a literal slug rather than being dropped. That preserves the one
 * capability the old hand-rolled panel had which a fixed candidate list would
 * otherwise remove.
 */
function VerifiesPanel({
  verifies,
  onAdd,
  onRemove,
  onOpenEntity,
}: VerifiesPanelProps) {
  // Per-group, because `GroupedRelationPicker` keeps each group's input state
  // locally: a single shared query would filter groups whose own box reads
  // empty, and would offer its literal in all of them.
  const [queries, setQueries] = useState<Record<string, string>>({});
  // A group's candidates are a whole collection, so an EMPTY group loads only
  // when its picker is first opened rather than on every AC the user clicks
  // through. A group that already holds refs loads eagerly — see `enabled`.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());

  const modules = clientPluginHost.listEntities().filter((m) => m.type !== 'ac');
  const moduleByType = new Map(modules.map((m) => [m.type as string, m]));

  const selected: Record<string, string[]> = {};
  for (const v of verifies) (selected[v.type] ??= []).push(v.slug);

  const candidates = useQueries({
    queries: modules.map((m) => ({
      queryKey: ['verify-candidates', m.type] as const,
      queryFn: () => m.listByTags({ tags: [], filter: 'or' as const }),
      staleTime: 60_000,
      /**
       * Opened pickers — and any group this AC ALREADY verifies something in.
       *
       * The second half is what keeps the dangling-ref badge visible on load.
       * It used to arrive precomputed as `ac.brokenVerifies`; 0.2.23 leaves the
       * type no read code to compute it with, so it is derived here against the
       * candidate list — and a list that only loads when the user opens a picker
       * would mark a dead ref only for someone already going looking for it.
       *
       * It costs one request per type this AC verifies, not per type that
       * exists: an AC names one or two, and the queries are shared and cached
       * across every AC the user clicks through.
       */
      enabled: opened.has(m.type as string) || (selected[m.type as string]?.length ?? 0) > 0,
    })),
  });
  const candidateByType = new Map(modules.map((m, i) => [m.type as string, candidates[i]]));

  const moduleTypes = modules.map((m) => m.type as string);
  const fetchedByType: Record<string, string[]> = {};
  for (const type of moduleTypes) {
    fetchedByType[type] = (candidateByType.get(type)?.data ?? []).map((e) => e.slug);
  }
  const groupInput = { moduleTypes, selected, fetchedByType, queries };

  const groups = verifyGroupTypes(groupInput).map((type) => {
    const mod = moduleByType.get(type);
    const result = candidateByType.get(type);

    return {
      key: type,
      // An inactive/unknown type has no module to name it, and a group whose
      // candidates failed to load must not read as "nothing to link".
      label: mod ? (result?.isError ? `${mod.label} (failed to load)` : mod.label) : `${type} (inactive)`,
      items: verifyGroupItems(type, groupInput).map((slug) => {
        /**
         * A dangling `verifies[]` entry, derived HERE rather than read off the
         * record.
         *
         * `ac.brokenVerifies` was computed by the `ac` detail view; 0.2.23
         * leaves no read code on a type, so the marker is derived from what this
         * panel already loaded — the same move `database-table` makes for its
         * counts. Both halves of the old `classifyVerifies` answer survive: an
         * unknown or inactive TYPE is visible without loading anything, and a
         * missing SLUG is visible against the group's candidate list.
         *
         * The slug half is claimed only once that list has actually arrived —
         * candidates load lazily, per opened group, and calling everything
         * dangling while the fetch is in flight would be worse than saying
         * nothing.
         */
        const loaded = !!mod && !result?.isError && result?.data !== undefined;
        const reason = !mod
          ? 'unknown type'
          : loaded && !fetchedByType[type]!.includes(slug)
            ? 'missing'
            : undefined;
        return {
          id: slug,
          label: slug,
          // The chip's own slot carries both the dangling marker and the
          // jump-to-entity affordance the old panel had on the slug itself.
          badge: (
            <>
              {reason && <Badge label={reason} variant="broken" small dot={false} />}
              {!reason && mod && onOpenEntity && (
                <button
                  onClick={() => onOpenEntity(type as EntityType, slug)}
                  title={`Open ${type} ${slug}`}
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
        setQueries((prev) => ({ ...prev, [groupKey]: '' }));
      }}
      onRemove={(groupKey, id) => {
        const idx = verifies.findIndex((v) => v.type === groupKey && v.slug === id);
        if (idx >= 0) onRemove(idx);
      }}
      onSearch={(q, groupKey) => {
        if (!groupKey) return;
        setQueries((prev) => ({ ...prev, [groupKey]: q }));
      }}
      onGroupOpen={(groupKey) =>
        setOpened((prev) => (prev.has(groupKey) ? prev : new Set(prev).add(groupKey)))
      }
    />
  );
}
