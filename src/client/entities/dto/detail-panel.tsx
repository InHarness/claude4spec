import { Plus, Trash } from 'lucide-react';
import { Braces } from 'lucide-react';
import { METHOD_STYLE } from '../../components/atoms.js';
import { Badge } from '../../host-ui-kit/actions/Badge.js';
import { DocEditor } from '../../host-ui-kit/detail/DocEditor.js';
import { TagPicker } from '../../host-ui-kit/detail/TagPicker.js';
import { useEntityDraftEditor } from '../_shared/useEntityDraftEditor.js';
import { useDto, useDeleteDto, useUpdateDto } from '../../hooks/useDtos.js';
import { useTags } from '../../hooks/useTags.js';
import { useReferences } from '../../hooks/useReferences.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { tagSlug } from '../../../shared/slug.js';
import type { Dto, DtoExample, DtoField, EntityType } from '../../../shared/entities.js';
import { ExamplesPanel } from '../../components/dto/ExamplesPanel.js';

interface Props {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenPage?: (rootId: string, path: string) => void;
}

interface Draft {
  name: string;
  description: string;
  fields: DtoField[];
  examples: DtoExample[];
  tags: string[];
}

function toDraft(d: Dto): Draft {
  return {
    name: d.name,
    description: d.description ?? '',
    fields: d.fields,
    examples: d.examples,
    tags: d.tags,
  };
}

export function DtoDetail({
  slug,
  onDeleted,
  onRenamed,
  onOpenEntity,
  onOpenPage,
}: Props) {
  const { data: dto, isLoading, error } = useDto(slug);
  const update = useUpdateDto();
  const remove = useDeleteDto();
  const { data: allTags = [] } = useTags();
  const { data: refs = [] } = useReferences('dto', dto?.slug ?? null);

  const { draft, dirty, patch } = useEntityDraftEditor({
    entity: dto,
    toDraft,
    save: async (current, d) => {
      const updated = await update.mutateAsync({
        slug: d.slug,
        input: {
          name: current.name,
          description: current.description || null,
          fields: current.fields,
          examples: current.examples,
          tags: current.tags,
        },
      });
      if (updated.slug !== d.slug) onRenamed(updated.slug);
      return updated;
    },
  });

  async function handleDelete() {
    if (!dto) return;
    const ok = await confirmDestructive({
      title: 'Delete DTO?',
      body: `Delete DTO ${dto.name}? All references to this DTO will become broken.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(dto.slug);
      onDeleted();
      toast.success(`DTO ${dto.name} deleted`);
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

  function updateField(index: number, partial: Partial<DtoField>) {
    if (!draft) return;
    const fields = draft.fields.map((f, i) => (i === index ? { ...f, ...partial } : f));
    patch({ fields });
  }

  function removeField(index: number) {
    if (!draft) return;
    patch({ fields: draft.fields.filter((_, i) => i !== index) });
  }

  function addField() {
    if (!draft) return;
    patch({ fields: [...draft.fields, { name: '', type: 'string', required: false }] });
  }

  if (isLoading && !dto) {
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading DTO…
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
  if (!dto || !draft) return null;

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 740, padding: '48px 56px 140px' }}>
        <div className="flex items-center gap-2 mb-1 text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          <span className="font-mono">{dto.slug}</span>
          <span>·</span>
          <span>
            updated{' '}
            {new Date(dto.updatedAt.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
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
          <Braces size={22} style={{ color: 'var(--c-accent)' }} />
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="flex-1 bg-transparent outline-none"
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: 'var(--c-ink)',
            }}
            placeholder="DTOName"
            spellCheck={false}
          />
        </div>

        <div className="mt-3">
          <TagPicker
            allTags={allTags}
            selected={draft.tags}
            onToggle={toggleTag}
            onCreate={handleCreateTag}
            variant="collapsed"
          />
        </div>

        <div className="mt-8">
          <SectionLabel>Description</SectionLabel>
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="What this DTO represents, which endpoints use it, invariants…"
          />
        </div>

        <div className="mt-10">
          <div className="flex items-center gap-2 mb-2">
            <SectionLabel>Fields</SectionLabel>
            <span className="flex-1" />
            <button
              onClick={addField}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
              style={{ color: 'var(--c-muted)', border: '1px dashed var(--c-hair-strong)' }}
            >
              <Plus size={11} /> add field
            </button>
          </div>
          {draft.fields.length === 0 && (
            <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
              No fields defined yet.
            </div>
          )}
          {draft.fields.length > 0 && (
            <div
              className="rounded-md"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
            >
              <div
                className="grid gap-2 px-3 py-1.5 text-[10.5px] uppercase font-mono tracking-wider"
                style={{
                  gridTemplateColumns: '1.5fr 1.2fr 0.6fr 2fr 28px',
                  color: 'var(--c-subtle)',
                  borderBottom: '1px solid var(--c-hair)',
                }}
              >
                <span>name</span>
                <span>type</span>
                <span>req</span>
                <span>description</span>
                <span />
              </div>
              {draft.fields.map((f, i) => (
                <div
                  key={i}
                  className="grid gap-2 px-3 py-1.5 items-center"
                  style={{
                    gridTemplateColumns: '1.5fr 1.2fr 0.6fr 2fr 28px',
                    borderBottom: i === draft.fields.length - 1 ? 'none' : '1px solid var(--c-hair)',
                  }}
                >
                  <input
                    value={f.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    className="font-mono text-[12.5px] bg-transparent outline-none"
                    style={{ color: 'var(--c-ink)' }}
                    placeholder="fieldName"
                    spellCheck={false}
                  />
                  <input
                    value={f.type}
                    onChange={(e) => updateField(i, { type: e.target.value })}
                    className="font-mono text-[12.5px] bg-transparent outline-none"
                    style={{ color: 'var(--c-muted)' }}
                    placeholder="string"
                    spellCheck={false}
                  />
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  <input
                    value={f.description ?? ''}
                    onChange={(e) => updateField(i, { description: e.target.value })}
                    className="text-[12.5px] bg-transparent outline-none"
                    style={{ color: 'var(--c-muted)' }}
                    placeholder="field description"
                  />
                  <button
                    onClick={() => removeField(i)}
                    className="text-[12px]"
                    style={{ color: 'var(--c-subtle)' }}
                    title="Remove field"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10">
          <ExamplesPanel
            examples={draft.examples}
            fields={draft.fields}
            onChange={(examples) => patch({ examples })}
          />
        </div>

        {dto.endpoints.length > 0 && (
          <div className="mt-10">
            <SectionLabel>Used by endpoints</SectionLabel>
            <ul
              className="rounded-md"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
            >
              {dto.endpoints.map((link, i) => (
                <li
                  key={`${link.endpointSlug}-${link.relation}-${link.statusCode ?? 'null'}`}
                  className="px-3 py-1.5 text-[12.5px] flex items-center gap-2"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--c-hair)' }}
                >
                  <span
                    className="text-[10.5px] uppercase font-mono tracking-wider"
                    style={{ color: 'var(--c-subtle)', minWidth: 64 }}
                  >
                    {link.relation}
                  </span>
                  <button
                    onClick={() => onOpenEntity?.('endpoint', link.endpointSlug)}
                    className="inline-flex items-center gap-2 hover:underline"
                    style={{ color: 'var(--c-accent-ink, var(--c-accent))' }}
                  >
                    <Badge
                      label={METHOD_STYLE[link.method].label}
                      color={METHOD_STYLE[link.method].bg}
                      foreground={METHOD_STYLE[link.method].fg}
                      active
                      dot={false}
                      mono
                      small
                    />
                    <span className="font-mono">{link.path}</span>
                  </button>
                  {link.statusCode !== null && (
                    <span
                      className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                    >
                      @ {link.statusCode}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

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
        </div>
      </div>
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
