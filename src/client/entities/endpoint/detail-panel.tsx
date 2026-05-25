import { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Trash } from 'lucide-react';
import { MethodBadge, METHOD_STYLE, TagChip } from '../../components/atoms.js';
import { DocEditor } from '../../components/DocEditor.js';
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
import { confirmDestructive, openPopover, toast } from '../../ui/events.js';
import type {
  Endpoint,
  EndpointDtoRelation,
  EntityType,
  HttpMethod,
} from '../../../shared/entities.js';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

interface Props {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onOpenEntity?: (type: EntityType, slug: string) => void;
  onOpenPage?: (path: string) => void;
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

  const [draft, setDraft] = useState<Draft | null>(null);
  const baselineRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);

  useEffect(() => {
    if (!endpoint) return;
    const next = toDraft(endpoint);
    const snapshot = JSON.stringify(next);
    if (baselineRef.current === snapshot) return;
    baselineRef.current = snapshot;
    setDraft(next);
  }, [endpoint]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    []
  );

  const dirty = useMemo(() => {
    if (!draft || !endpoint) return false;
    return JSON.stringify(draft) !== baselineRef.current;
  }, [draft, endpoint]);

  function scheduleAutosave(next: Draft) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void runSave(next), 500);
  }

  async function runSave(current: Draft) {
    if (!endpoint) return;
    try {
      const updated = await update.mutateAsync({
        slug: endpoint.slug,
        input: {
          method: current.method,
          path: current.path,
          summary: current.summary,
          description: current.description || null,
          tags: current.tags,
        },
      });
      baselineRef.current = JSON.stringify(toDraft(updated));
      if (updated.slug !== endpoint.slug) onRenamed(updated.slug);
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

  async function addNewTag(e: React.MouseEvent<HTMLElement>) {
    if (!draft) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const result = await openPopover(
      'create-tag',
      { x: rect.left, y: rect.bottom + 4 },
      { contextLabel: endpoint ? `${endpoint.method} ${endpoint.path}` : undefined },
    );
    if (!result) return;
    const tslug = result.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!tslug || draft.tags.includes(tslug)) return;
    patch({ tags: [...draft.tags, tslug] });
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
      <div className="mx-auto" style={{ maxWidth: 740, padding: '48px 56px 140px' }}>
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
          <MethodPicker value={draft.method} onChange={(m) => patch({ method: m })} />
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

        <div className="mt-5 flex items-center gap-2 flex-wrap">
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

        <div className="mt-8">
          <SectionLabel>Description</SectionLabel>
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="Describe what this endpoint does, invariants, gotchas…"
            onOpenEntity={onOpenEntity}
          />
        </div>

        <div className="mt-10">
          <SectionLabel>Linked DTOs</SectionLabel>
          <LinkedDtos
            endpoint={endpoint}
            availableDtos={allDtos.map((d) => ({ slug: d.slug, name: d.name }))}
            onLink={(dtoSlug, relation, statusCode) =>
              linkDto.mutate({ slug: endpoint.slug, dtoSlug, relation, statusCode })
            }
            onUnlink={(dtoSlug, relation, statusCode) =>
              unlinkDto.mutate({ slug: endpoint.slug, dtoSlug, relation, statusCode })
            }
            onOpenDto={(dtoSlug) => onOpenEntity?.('dto', dtoSlug)}
          />
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

function MethodPicker({
  value,
  onChange,
}: {
  value: HttpMethod;
  onChange: (m: HttpMethod) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded px-1 py-0.5"
        style={{ border: '1px solid transparent' }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
        title="change method"
      >
        <MethodBadge method={value} large />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 rounded-md p-1 flex flex-col"
          style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-hair-strong)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 40,
          }}
        >
          {METHODS.map((m) => (
            <button
              key={m}
              onClick={() => {
                onChange(m);
                setOpen(false);
              }}
              className="px-2 py-1 text-left rounded text-[11px] font-mono font-semibold"
              style={{
                background: value === m ? METHOD_STYLE[m].bg : 'transparent',
                color: value === m ? METHOD_STYLE[m].fg : 'var(--c-muted)',
              }}
            >
              {METHOD_STYLE[m].label}
            </button>
          ))}
        </div>
      )}
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

const RELATIONS: EndpointDtoRelation[] = ['request', 'response', 'error'];

function LinkedDtos({
  endpoint,
  availableDtos,
  onLink,
  onUnlink,
  onOpenDto,
}: {
  endpoint: Endpoint;
  availableDtos: Array<{ slug: string; name: string }>;
  onLink: (dtoSlug: string, relation: EndpointDtoRelation, statusCode: number | null) => void;
  onUnlink: (dtoSlug: string, relation: EndpointDtoRelation, statusCode: number | null) => void;
  onOpenDto: (dtoSlug: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState<EndpointDtoRelation | null>(null);
  const [pickerDto, setPickerDto] = useState<string | null>(null);
  const [pickerStatus, setPickerStatus] = useState<string>('');
  const grouped = useMemo(() => {
    const m: Record<EndpointDtoRelation, Endpoint['dtos']> = {
      request: [],
      response: [],
      error: [],
    };
    for (const link of endpoint.dtos) m[link.relation].push(link);
    return m;
  }, [endpoint.dtos]);

  function resetPicker() {
    setPickerOpen(null);
    setPickerDto(null);
    setPickerStatus('');
  }

  function openPicker(rel: EndpointDtoRelation) {
    setPickerOpen(pickerOpen === rel ? null : rel);
    setPickerDto(null);
    setPickerStatus(rel === 'response' ? '200' : rel === 'error' ? '400' : '');
  }

  function submitPicker(rel: EndpointDtoRelation) {
    if (!pickerDto) return;
    const status =
      rel === 'request'
        ? null
        : pickerStatus.trim() === ''
          ? null
          : Number.isInteger(Number(pickerStatus))
            ? Number(pickerStatus)
            : null;
    onLink(pickerDto, rel, status);
    resetPicker();
  }

  return (
    <div
      className="rounded-md"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
    >
      {RELATIONS.map((rel, i) => {
        const linked = grouped[rel];
        return (
          <div
            key={rel}
            style={{
              borderTop: i === 0 ? 'none' : '1px solid var(--c-hair)',
              padding: '10px 12px',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[10.5px] uppercase font-mono tracking-wider"
                style={{ color: 'var(--c-subtle)', minWidth: 64 }}
              >
                {rel}
              </span>
              <div className="flex-1 flex flex-wrap items-center gap-1.5">
                {linked.length === 0 && (
                  <span className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
                    —
                  </span>
                )}
                {linked.map((link) => (
                  <span
                    key={`${link.dtoSlug}:${link.statusCode ?? 'null'}`}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-[2px]"
                    style={{
                      background: 'var(--c-panel)',
                      border: '1px solid var(--c-hair)',
                      fontSize: 12,
                    }}
                  >
                    <button
                      onClick={() => onOpenDto(link.dtoSlug)}
                      className="inline-flex items-center gap-1"
                      style={{ color: 'var(--c-ink)' }}
                    >
                      <Braces size={11} style={{ color: 'var(--c-accent)' }} />
                      {link.dtoName}
                    </button>
                    {link.statusCode !== null && (
                      <span
                        className="font-mono text-[10.5px] px-1 rounded"
                        style={{
                          background: 'var(--c-card)',
                          color: 'var(--c-muted)',
                        }}
                      >
                        @ {link.statusCode}
                      </span>
                    )}
                    <button
                      onClick={() => onUnlink(link.dtoSlug, rel, link.statusCode)}
                      className="opacity-70 hover:opacity-100"
                      style={{ color: 'var(--c-subtle)' }}
                      aria-label={`unlink ${link.dtoName}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => openPicker(rel)}
                  className="text-[11.5px] px-2 py-0.5 rounded-full"
                  style={{
                    color: 'var(--c-subtle)',
                    border: '1px dashed var(--c-hair-strong)',
                  }}
                >
                  + link
                </button>
              </div>
            </div>
            {pickerOpen === rel && (
              <div
                className="mt-2 p-2 rounded flex flex-wrap items-center gap-1.5"
                style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
              >
                {availableDtos.length === 0 ? (
                  <span className="text-[11.5px] italic" style={{ color: 'var(--c-subtle)' }}>
                    No DTOs yet — create one first.
                  </span>
                ) : (
                  <>
                    {availableDtos.map((c) => (
                      <button
                        key={c.slug}
                        onClick={() => setPickerDto(c.slug)}
                        className="text-[11.5px] inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                        style={{
                          background:
                            pickerDto === c.slug
                              ? 'var(--c-accent-soft)'
                              : 'var(--c-card)',
                          border: `1px solid ${pickerDto === c.slug ? 'var(--c-accent)' : 'var(--c-hair)'}`,
                          color: 'var(--c-ink)',
                        }}
                      >
                        <Braces size={11} style={{ color: 'var(--c-accent)' }} />
                        {c.name}
                      </button>
                    ))}
                    {rel !== 'request' && (
                      <input
                        value={pickerStatus}
                        onChange={(e) => setPickerStatus(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="status"
                        className="font-mono text-[11.5px] rounded px-1.5 py-0.5 outline-none"
                        style={{
                          width: 64,
                          background: 'var(--c-card)',
                          border: '1px solid var(--c-hair)',
                          color: 'var(--c-ink)',
                        }}
                      />
                    )}
                    <button
                      onClick={() => submitPicker(rel)}
                      disabled={!pickerDto}
                      className="text-[11.5px] px-2 py-0.5 rounded"
                      style={{
                        background: pickerDto ? 'var(--c-accent)' : 'var(--c-card)',
                        color: pickerDto ? '#fff' : 'var(--c-subtle)',
                        border: '1px solid var(--c-hair-strong)',
                        cursor: pickerDto ? 'pointer' : 'not-allowed',
                      }}
                    >
                      link
                    </button>
                    <button
                      onClick={resetPicker}
                      className="text-[11.5px] px-2 py-0.5"
                      style={{ color: 'var(--c-muted)' }}
                    >
                      cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
