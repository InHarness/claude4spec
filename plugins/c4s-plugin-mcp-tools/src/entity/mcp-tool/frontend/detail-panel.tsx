/**
 * `detailPanel` — the required frontend slot, and the only one that is a SCREEN.
 * Chip / card / row are pure embeds; the list is a composition. This panel is the
 * one surface that resolves an entity, holds a draft, calls mutations and draws
 * loading / absent / data.
 *
 * Props contract: the host injects ONLY `slug`. `onDeleted?` / `onRenamed?` are
 * panel→host notifications; `onBackToList` / `onSwitchView` are plugin-internal
 * wiring supplied by the route wrapper, the one layer holding `useNavigate`.
 *
 * The panel calls `useGetBySlug(slug)` itself and discriminates three states:
 * `undefined` → loading, `null` → not found, otherwise the editable form. The
 * WRITE side is the plugin's — the host ships no save path — so saving is
 * `useUpdateMcpTool` on a debounce (live autosave, no Save button), with a
 * `currentSlugRef` tracking the live slug across renames.
 *
 * THE ONE LAYOUT REQUIREMENT THAT IS NOT COSMETIC. The CONTRACT block
 * (`description`, `params[]`, `returns`, `sampleReturn`, the hints) is visually
 * separated from LOGIC, which sits below its own rule. This is the only place the
 * entity/L3 boundary is visible to a human: everything above the separator
 * transfers verbatim into a tool definition in code, and everything below it does
 * not travel at all. A panel that interleaves them teaches the wrong thing on
 * every read.
 *
 * Details and History are TWO SIBLING ROUTES, not an in-panel tab, so History is
 * deep-linkable and Back does not land on a stale view. History itself is NOT
 * composed here: it is the host's shared `EntityVersionHistoryView`, given
 * nothing but `type` + `slug` — one component for host and plugins, so the view
 * cannot drift per entity type.
 *
 * Colours are `var(--c-*)` tokens only, never literals.
 */

import type { CSSProperties, FC, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAssignTags,
  useEntityTags,
  useReferences,
  useRemoveEntityTag,
  useTags,
} from '@c4s/plugin-runtime';
import {
  ActionButton,
  Dialog,
  DetailPanelShell,
  EmptyState,
  EntityVersionHistoryView,
  LoadingState,
  SegmentedControlTabs,
  TagPicker,
} from '@c4s/plugin-runtime/ui';
import { MCP_TOOL_LABEL_PLURAL, MCP_TOOL_TYPE, serverTagFor } from '../../../identity.js';
import type { McpTool, McpToolHint, McpToolParam } from '../types.js';
import { MCP_TOOL_HINTS } from '../types.js';
import { readHint } from './summary.js';
import { useDeleteMcpTool, useGetBySlug, useUpdateMcpTool } from './hooks.js';

const AUTOSAVE_DELAY_MS = 500;

type EntityView = 'details' | 'history';
type SwitchView = (view: EntityView, opts?: { replace?: boolean }) => void;

export interface EntityDetailProps {
  slug: string;
  onDeleted?: () => void;
  onRenamed?: (newSlug: string) => void;
  onBackToList?: () => void;
  onSwitchView?: SwitchView;
}

const MUTED: CSSProperties = { fontSize: 12.5, color: 'var(--c-muted)' };
const INPUT: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--c-hair)',
  background: 'var(--c-panel)',
  color: 'var(--c-ink)',
};
const MONO_INPUT: CSSProperties = { ...INPUT, fontFamily: 'var(--font-mono, monospace)' };
const SECTION_LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--c-muted)',
};

const Row: FC<{ label: string; children: ReactNode; hint?: string }> = ({
  label,
  children,
  hint,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={SECTION_LABEL}>{label}</label>
    {children}
    {hint ? <span style={{ fontSize: 11.5, color: 'var(--c-subtle)' }}>{hint}</span> : null}
  </div>
);

/**
 * The three-state hint control.
 *
 * Three buttons, not a checkbox — a checkbox has two states and this value has
 * three, so the absent case would have had to be spelled as "unchecked", which is
 * exactly the collapse the schema refuses to make. "Not declared" is the resting
 * state and is selectable: un-declaring a hint has to be as reachable as
 * declaring one.
 */
const HintControl: FC<{
  label: string;
  value: McpToolHint;
  onChange: (next: McpToolHint) => void;
}> = ({ label, value, onChange }) => {
  const state = readHint(value);
  const option = (id: 'undeclared' | 'yes' | 'no', text: string, next: McpToolHint) => (
    <button
      type="button"
      onClick={() => onChange(next)}
      style={{
        padding: '2px 8px',
        fontSize: 11.5,
        borderRadius: 5,
        border: '1px solid var(--c-hair)',
        background: state === id ? 'var(--c-accent-soft)' : 'var(--c-panel)',
        color: state === id ? 'var(--c-ink)' : 'var(--c-muted)',
        fontWeight: state === id ? 600 : 400,
      }}
    >
      {text}
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12.5, color: 'var(--c-ink)', minWidth: 96 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {option('undeclared', 'Not declared', null)}
        {option('yes', 'Yes', true)}
        {option('no', 'No', false)}
      </div>
    </div>
  );
};

/** The `params[]` editor — the flat reading of `inputSchema`. */
const ParamsEditor: FC<{
  params: McpToolParam[];
  onChange: (next: McpToolParam[]) => void;
}> = ({ params, onChange }) => {
  const patch = (i: number, part: Partial<McpToolParam>) =>
    onChange(params.map((p, j) => (j === i ? { ...p, ...part } : p)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {params.length === 0 ? (
        /*
          An empty list is a LEGAL and common state — an operation taking only a
          slug — so it says so rather than rendering nothing, which would read as
          "not described yet".
        */
        <span style={MUTED}>No parameters. This is a legal state, not a gap.</span>
      ) : null}

      {params.map((p, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
            padding: 6,
            borderRadius: 6,
            border: '1px solid var(--c-hair)',
            background: 'var(--c-panel)',
          }}
        >
          <input
            value={p.name}
            onChange={(e) => patch(i, { name: e.target.value })}
            placeholder="name"
            style={{ ...MONO_INPUT, flex: '0 0 26%' }}
          />
          <input
            value={p.type}
            onChange={(e) => patch(i, { type: e.target.value })}
            placeholder="string"
            style={{ ...MONO_INPUT, flex: '0 0 22%' }}
          />
          <input
            value={p.description ?? ''}
            onChange={(e) => patch(i, { description: e.target.value })}
            placeholder="What it is, for the model"
            style={{ ...INPUT, flex: 1 }}
          />
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, paddingTop: 6 }}
          >
            <input
              type="checkbox"
              checked={Boolean(p.required)}
              onChange={(e) => patch(i, { required: e.target.checked })}
            />
            req
          </label>
          <ActionButton
            label="✕"
            variant="ghost"
            onClick={() => onChange(params.filter((_, j) => j !== i))}
          />
        </div>
      ))}

      <div>
        <ActionButton
          label="Add parameter"
          variant="secondary"
          onClick={() => onChange([...params, { name: '', type: 'string' }])}
        />
      </div>
    </div>
  );
};

function messageOf(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : 'Update failed';
}

/**
 * Tags — host-owned, no plugin column. Read via `useEntityTags` (tag SLUGS),
 * written via `useAssignTags` (whole-set, takes tag NAMES, auto-creates missing
 * ones) and `useRemoveEntityTag`.
 *
 * `expectedServerTag` is the one piece of type-specific behaviour here: the panel
 * WARNS when the mirror tag does not match the `server` field. It does not fix it
 * and does not block the write — the brief's position is that this pair is author
 * discipline, and silently rewriting a tag under the author would be a different
 * and worse behaviour than telling them. Without the warning the failure is
 * invisible: the tool simply stops appearing in its server's embedded list.
 */
const TagsField: FC<{ slug: string; expectedServerTag: string }> = ({
  slug,
  expectedServerTag,
}) => {
  const catalog = useTags();
  const entityTags = useEntityTags(MCP_TOOL_TYPE, slug);
  const assign = useAssignTags();
  const removeTag = useRemoveEntityTag();

  if (entityTags.data === undefined) return <span style={MUTED}>Loading tags…</span>;

  const nameBySlug = new Map((catalog.data ?? []).map((t) => [t.slug, t] as const));
  const currentNames = entityTags.data.map((s) => nameBySlug.get(s)?.name ?? s);
  const hasMirrorTag = entityTags.data.includes(expectedServerTag);

  const handleToggle = (tagSlug: string) => {
    if (entityTags.data!.includes(tagSlug)) {
      removeTag.mutate({ type: MCP_TOOL_TYPE, slug, tagSlug });
      return;
    }
    const name = nameBySlug.get(tagSlug)?.name ?? tagSlug;
    assign.mutate({ type: MCP_TOOL_TYPE, slug, tags: [...currentNames, name] });
  };

  const handleCreate = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || assign.isPending) return;
    if (currentNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return;
    assign.mutate({ type: MCP_TOOL_TYPE, slug, tags: [...currentNames, trimmed] });
  };

  const error = messageOf(assign.error) ?? messageOf(removeTag.error);

  return (
    <>
      <TagPicker
        allTags={(catalog.data ?? []).map((t) => ({
          slug: t.slug,
          name: t.name,
          color: t.color ?? undefined,
        }))}
        selected={entityTags.data}
        onToggle={handleToggle}
        onCreate={handleCreate}
        variant="collapsed"
      />
      {hasMirrorTag ? null : (
        <p
          role="alert"
          style={{ fontSize: 11.5, color: 'var(--c-red)', marginTop: 4 }}
        >
          Missing the mirror tag <code>{expectedServerTag}</code> — this tool will not appear in
          its server’s embedded list. Nothing validates this pair; add the tag above.
        </p>
      )}
      {error ? (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--c-red)' }}>
          {error}
        </p>
      ) : null}
    </>
  );
};

const ReferencesSection: FC<{ slug: string }> = ({ slug }) => {
  const references = useReferences(MCP_TOOL_TYPE, slug);
  const hits = references.data ?? [];
  if (references.isLoading) return <LoadingState lines={2} />;
  if (hits.length === 0)
    return <div style={{ fontSize: 12.5, color: 'var(--c-subtle)' }}>Not referenced by any page.</div>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {hits.map((ref, i) => (
        <li
          key={`${ref.pagePath}:${ref.line}:${i}`}
          style={{
            display: 'flex',
            gap: 6,
            padding: '4px 0',
            fontSize: 12.5,
            borderTop: i === 0 ? 'none' : '1px solid var(--c-hair)',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{ref.pagePath}</span>
          <span style={{ color: 'var(--c-muted)' }}>:{ref.line}</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--c-muted)' }}>{ref.tagType}</span>
        </li>
      ))}
    </ul>
  );
};

/** Shared frame between the Details and History routes. */
const McpToolDetailShell: FC<{
  slug: string;
  activeView: EntityView;
  onBackToList?: () => void;
  onSwitchView?: SwitchView;
  children: ReactNode;
}> = ({ slug, activeView, onBackToList, onSwitchView, children }) => (
  <DetailPanelShell
    breadcrumb={[{ label: MCP_TOOL_LABEL_PLURAL, onClick: onBackToList }, { label: slug }]}
    actions={
      <SegmentedControlTabs
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'history', label: 'History' },
        ]}
        active={activeView}
        onChange={(id) => {
          const next: EntityView = id === 'history' ? 'history' : 'details';
          if (next === activeView) return;
          onSwitchView?.(next);
        }}
      />
    }
  >
    {children}
  </DetailPanelShell>
);

export const McpToolHistory: FC<{
  slug: string;
  onBackToList?: () => void;
  onSwitchView?: SwitchView;
}> = ({ slug, onBackToList, onSwitchView }) => (
  <McpToolDetailShell
    slug={slug}
    activeView="history"
    onBackToList={onBackToList}
    onSwitchView={onSwitchView}
  >
    <EntityVersionHistoryView
      type={MCP_TOOL_TYPE}
      slug={slug}
      onRestored={() => onSwitchView?.('details', { replace: true })}
    />
  </McpToolDetailShell>
);

export const McpToolDetail: FC<EntityDetailProps> = ({
  slug,
  onDeleted,
  onRenamed,
  onBackToList,
  onSwitchView,
}) => {
  const { data: entity } = useGetBySlug(slug);

  if (entity === undefined)
    return (
      <McpToolDetailShell
        slug={slug}
        activeView="details"
        onBackToList={onBackToList}
        onSwitchView={onSwitchView}
      >
        <LoadingState lines={6} />
      </McpToolDetailShell>
    );

  if (entity === null)
    return (
      <McpToolDetailShell
        slug={slug}
        activeView="details"
        onBackToList={onBackToList}
        onSwitchView={onSwitchView}
      >
        <EmptyState title="Not found" hint={<code>{slug}</code>} />
      </McpToolDetailShell>
    );

  return (
    <McpToolDetailShell
      slug={slug}
      activeView="details"
      onBackToList={onBackToList}
      onSwitchView={onSwitchView}
    >
      <McpToolDetailForm entity={entity} onDeleted={onDeleted} onRenamed={onRenamed} />
    </McpToolDetailShell>
  );
};

const McpToolDetailForm: FC<{
  entity: McpTool;
  onDeleted?: () => void;
  onRenamed?: (newSlug: string) => void;
}> = ({ entity, onDeleted, onRenamed }) => {
  const [draft, setDraft] = useState<McpTool>(entity);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateMcpTool();
  const remove = useDeleteMcpTool();

  const debounceRef = useRef<number | null>(null);
  const currentSlugRef = useRef(entity.slug);

  // The host remounts this form with `key={slug}`, so a slug change means a
  // different entity; this only resyncs when the server sends a newer record.
  useEffect(() => {
    setDraft(entity);
    currentSlugRef.current = entity.slug;
  }, [entity.slug, entity.updatedAt]);

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const save = useCallback(
    (next: McpTool) => {
      update.mutate(
        {
          slug: currentSlugRef.current,
          body: {
            name: next.name,
            server: next.server,
            description: next.description,
            params: next.params ?? [],
            returns: next.returns ?? null,
            sampleReturn: next.sampleReturn ?? null,
            readOnlyHint: next.readOnlyHint ?? null,
            destructiveHint: next.destructiveHint ?? null,
            idempotentHint: next.idempotentHint ?? null,
            openWorldHint: next.openWorldHint ?? null,
            logic: next.logic ?? null,
          },
        },
        {
          onSuccess: (saved) => {
            if (saved.slug !== currentSlugRef.current) {
              currentSlugRef.current = saved.slug;
              onRenamed?.(saved.slug);
            }
          },
        },
      );
    },
    [update, onRenamed],
  );

  const edit = (part: Partial<McpTool>) => {
    const next = { ...draft, ...part };
    setDraft(next);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => save(next), AUTOSAVE_DELAY_MS);
  };

  const error = messageOf(update.error);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      {/* ── Identity ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: '0 0 40%' }}>
          <Row
            label="Server"
            hint={`Mirrored as the tag ${serverTagFor(draft.server || '…')}`}
          >
            <input
              value={draft.server}
              onChange={(e) => edit({ server: e.target.value })}
              style={MONO_INPUT}
            />
          </Row>
        </div>
        <div style={{ flex: 1 }}>
          {/*
            Editing `name` does NOT move the slug — the pattern runs at create
            only. Said out loud here because the opposite is the natural guess.
          */}
          <Row label="Name" hint="Editing this does not rename the entity; the slug is fixed at create.">
            <input
              value={draft.name}
              onChange={(e) => edit({ name: e.target.value })}
              style={MONO_INPUT}
            />
          </Row>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={MUTED}>
          <code>{currentSlugRef.current}</code>
        </span>
        <span style={MUTED}>
          {update.isPending ? 'Saving…' : entity.updatedAt ? `Updated ${entity.updatedAt}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <ActionButton label="Delete" variant="ghost" onClick={() => setConfirmDelete(true)} />
      </div>

      {error ? (
        <p role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>
          {error}
        </p>
      ) : null}

      {/*
        ── THE CONTRACT ────────────────────────────────────────────────
        Everything in this block transfers verbatim into the tool definition in
        code. The heading says so, because that is the fact a reader needs before
        deciding what may be written here.
      */}
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 14,
          borderRadius: 8,
          border: '1px solid var(--c-hair)',
          background: 'var(--c-card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={SECTION_LABEL}>Contract</span>
          <span style={{ fontSize: 11.5, color: 'var(--c-subtle)' }}>
            transferred verbatim into the tool definition
          </span>
        </div>

        <Row label="Description" hint="Goes to the model. No spec anchors, page names or module numbers.">
          <textarea
            value={draft.description}
            onChange={(e) => edit({ description: e.target.value })}
            rows={3}
            style={{ ...INPUT, resize: 'vertical' }}
          />
        </Row>

        <Row label="Parameters">
          <ParamsEditor params={draft.params ?? []} onChange={(params) => edit({ params })} />
        </Row>

        <Row label="Returns" hint="The payload only — never the content[] / isError envelope.">
          <textarea
            value={draft.returns ?? ''}
            onChange={(e) => edit({ returns: e.target.value })}
            rows={2}
            style={{ ...INPUT, resize: 'vertical' }}
          />
        </Row>

        <Row
          label="Sample return"
          hint="Only for a return that is nested or carries an array of objects. A flat return belongs in Returns."
        >
          <textarea
            value={draft.sampleReturn ?? ''}
            onChange={(e) => edit({ sampleReturn: e.target.value })}
            rows={3}
            style={{ ...MONO_INPUT, resize: 'vertical' }}
          />
        </Row>

        <Row
          label="Annotations"
          hint="Hints, not guarantees — a client must treat them as untrusted. No gate may rest on them."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {MCP_TOOL_HINTS.map(({ key, label }) => (
              <HintControl
                key={key}
                label={label}
                value={draft[key] as McpToolHint}
                onChange={(next) => edit({ [key]: next } as Partial<McpTool>)}
              />
            ))}
          </div>
        </Row>
      </section>

      {/*
        ── THE LOGIC ───────────────────────────────────────────────────
        Below its own separator, and outside the contract card, because none of
        this travels: it is not part of the tool definition and is never sent to
        a model. The visual break is the only place this boundary is legible to a
        human, which is why it is a real separation and not a heading.
      */}
      <div style={{ borderTop: '1px solid var(--c-hair)', paddingTop: 16 }}>
        <Row
          label="Logic"
          hint="How the tool works inside — steps, validations, refusal conditions. Never sent to the model. Max 1000 characters."
        >
          <textarea
            value={draft.logic ?? ''}
            onChange={(e) => edit({ logic: e.target.value })}
            rows={6}
            style={{ ...INPUT, resize: 'vertical' }}
          />
        </Row>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--c-subtle)' }}>
          {(draft.logic ?? '').length} / 1000
        </div>
      </div>

      <Row label="Tags">
        <TagsField slug={currentSlugRef.current} expectedServerTag={serverTagFor(draft.server)} />
      </Row>

      <Row label="Referenced by">
        <ReferencesSection slug={currentSlugRef.current} />
      </Row>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this tool?"
        size="sm"
        footer={
          <>
            <ActionButton label="Cancel" variant="ghost" onClick={() => setConfirmDelete(false)} />
            <ActionButton
              label={remove.isPending ? 'Deleting…' : 'Delete'}
              variant="primary"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { slug: currentSlugRef.current },
                  {
                    onSuccess: () => {
                      setConfirmDelete(false);
                      onDeleted?.();
                    },
                  },
                )
              }
            />
          </>
        }
      >
        <p style={{ fontSize: 13, color: 'var(--c-ink)' }}>
          <code>{currentSlugRef.current}</code> will be removed. The description of the tool goes
          with it; the tool itself, wherever it is mounted, is untouched.
        </p>
      </Dialog>
    </div>
  );
};
