import { useEffect, useState } from 'react';
import { Trash } from 'lucide-react';
import { METHOD_STYLE } from '../../components/atoms.js';
import { DocEditor } from '../../host-ui-kit/detail/DocEditor.js';
import { TagPicker } from '../../host-ui-kit/detail/TagPicker.js';
import { EnumBadgePicker } from '../../host-ui-kit/pickers/EnumBadgePicker.js';
import { GroupedRelationPicker } from '../../host-ui-kit/pickers/GroupedRelationPicker.js';
import { FieldGrid } from '../../host-ui-kit/core/FieldGrid.js';
import { FieldRow } from '../../host-ui-kit/core/FieldRow.js';
import { useEntityDraftEditor } from '../_shared/useEntityDraftEditor.js';
import {
  useEndpoint,
  useDeleteEndpoint,
  useLinkDto,
  useUnlinkDto,
  useUpdateEndpoint,
} from '../../hooks/useEndpoints.js';
import { useDtos } from '../../hooks/useDtos.js';
import { useTags } from '../../hooks/useTags.js';
import { useReferences } from '../../hooks/useReferences.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { tagSlug } from '../../../shared/slug.js';
import type { Endpoint, EndpointDtoRelation, EntityType, HttpMethod } from '../../../shared/entities.js';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const RELATIONS: EndpointDtoRelation[] = ['request', 'response', 'error'];

interface Props {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenPage?: (rootId: string, path: string) => void;
}

interface Draft {
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
}

function toDraft(e: Endpoint): Draft {
  return {
    method: e.method,
    path: e.path,
    summary: e.summary ?? '',
    description: e.description ?? '',
    tags: e.tags,
  };
}

export function EndpointDetail({
  slug,
  onDeleted,
  onRenamed,
  onOpenEntity,
  onOpenPage,
}: Props) {
  const { data: endpoint, isLoading, error } = useEndpoint(slug);
  const update = useUpdateEndpoint();
  const remove = useDeleteEndpoint();
  const linkDto = useLinkDto();
  const unlinkDto = useUnlinkDto();
  const { data: allTags = [] } = useTags();
  const { data: allDtos = [] } = useDtos();
  const { data: refs = [] } = useReferences('endpoint', endpoint?.slug ?? null);

  const { draft, dirty, patch } = useEntityDraftEditor({
    entity: endpoint,
    toDraft,
    save: async (current, ep) => {
      const updated = await update.mutateAsync({
        slug: ep.slug,
        input: {
          method: current.method,
          path: current.path,
          summary: current.summary,
          description: current.description || null,
          tags: current.tags,
        },
      });
      if (updated.slug !== ep.slug) onRenamed(updated.slug);
      return updated;
    },
  });

  async function handleDelete() {
    if (!endpoint) return;
    const ok = await confirmDestructive({
      title: 'Delete endpoint?',
      body: `Delete ${endpoint.method} ${endpoint.path}? All references to this endpoint will become broken.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(endpoint.slug);
      onDeleted();
      toast.success(`Endpoint ${endpoint.method} ${endpoint.path} deleted`);
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

  if (isLoading && !endpoint) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading endpoint…
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
  if (!endpoint || !draft) return null;

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <FieldGrid maxWidth={740}>
        <div className="flex items-center gap-2 mb-1 text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          <span className="font-mono">{endpoint.slug}</span>
          <span>·</span>
          <span>
            updated{' '}
            {new Date(endpoint.updatedAt.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
          {update.isPending && <span style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}>saving…</span>}
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
          <EnumBadgePicker
            options={METHODS.map((m) => ({ value: m, label: METHOD_STYLE[m].label, color: METHOD_STYLE[m].fg }))}
            value={draft.method}
            onChange={(m) => patch({ method: m as HttpMethod })}
          />
          <input
            value={draft.path}
            onChange={(e) => patch({ path: e.target.value })}
            className="flex-1 bg-transparent outline-none font-mono"
            style={{
              fontSize: 28,
              color: 'var(--c-ink)',
              fontWeight: 600,
            }}
            placeholder="/api/..."
            spellCheck={false}
          />
        </div>

        <input
          value={draft.summary}
          onChange={(e) => patch({ summary: e.target.value })}
          className="w-full bg-transparent outline-none text-[15px] mt-1"
          style={{ color: 'var(--c-muted)' }}
          placeholder="Short summary…"
        />

        <FieldRow label="Tags">
          <TagPicker
            allTags={allTags}
            selected={draft.tags}
            onToggle={toggleTag}
            onCreate={handleCreateTag}
            variant="collapsed"
          />
        </FieldRow>

        <FieldRow label="Description" align="start">
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="Describe what this endpoint does, invariants, gotchas…"
          />
        </FieldRow>

        <FieldRow label="Linked DTOs" align="start">
          <GroupedRelationPicker
            groups={RELATIONS.map((rel) => ({
              key: rel,
              label: rel,
              items: allDtos.map((d) => {
                const link = endpoint.dtos.find((l) => l.dtoSlug === d.slug && l.relation === rel);
                return {
                  id: d.slug,
                  label: d.name,
                  badge:
                    rel === 'request' ? undefined : (
                      <StatusBadge
                        value={link?.statusCode ?? (rel === 'response' ? 200 : 400)}
                        onChange={(status) => {
                          if (link) unlinkDto.mutate({ slug: endpoint.slug, dtoSlug: d.slug, relation: rel, statusCode: link.statusCode });
                          linkDto.mutate({ slug: endpoint.slug, dtoSlug: d.slug, relation: rel, statusCode: status });
                        }}
                      />
                    ),
                };
              }),
            }))}
            selected={RELATIONS.reduce<Record<string, string[]>>((acc, rel) => {
              acc[rel] = endpoint.dtos.filter((l) => l.relation === rel).map((l) => l.dtoSlug);
              return acc;
            }, {})}
            onAdd={(rel, dtoSlug) => {
              const relation = rel as EndpointDtoRelation;
              const status = relation === 'response' ? 200 : relation === 'error' ? 400 : null;
              linkDto.mutate({ slug: endpoint.slug, dtoSlug, relation, statusCode: status });
            }}
            onRemove={(rel, dtoSlug) => {
              const relation = rel as EndpointDtoRelation;
              const link = endpoint.dtos.find((l) => l.dtoSlug === dtoSlug && l.relation === relation);
              unlinkDto.mutate({ slug: endpoint.slug, dtoSlug, relation, statusCode: link?.statusCode ?? null });
            }}
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

/**
 * Inline-editable status code, passed as `GroupedRelationPicker`'s per-item
 * `badge` slot — the generic picker contract has no status-code field of its
 * own, so an editable node is what restores that capability (see the filed
 * `missing`-kind patch on this brief).
 */
function StatusBadge({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={() => {
        const n = draft.trim() === '' ? null : Number(draft);
        if (n !== value) onChange(Number.isInteger(n) ? n : null);
      }}
      aria-label="status code"
      className="font-mono text-[10.5px] px-1 rounded outline-none"
      style={{ width: 34, background: 'var(--c-card)', color: 'var(--c-muted)', border: 'none' }}
    />
  );
}
