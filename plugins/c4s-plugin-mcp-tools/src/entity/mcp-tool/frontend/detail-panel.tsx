/**
 * `detailPanel` — the required frontend slot, and the only one that is a SCREEN.
 * Chip / card / row are pure embeds; the list is a composition. This panel is the
 * one surface that resolves an entity, holds a draft and calls mutations.
 *
 * ANATOMY. This is the established shape of an entity detail panel in this repo
 * — `ac`, `dto`, `endpoint`, `ui-view` and `design-system` are the same file with
 * the domain swapped, and this is that file for `mcp-tool`:
 *
 *   scroller → `FieldGrid maxWidth={740}`
 *     meta strip   slug · updated · saving/edited · Delete
 *     title        entity icon + a borderless 22px input
 *     Tags         first under the title, always, and unlabelled — flush left
 *     Description  second, full width, a `DocEditor` under its own heading
 *     Server       third, then the Contract block
 *     `FieldRow`s  label in a fixed 140px column, value on the right
 *     `mt-6`       is the section break; there is no Card and no Section
 *
 * The two departures from `FieldRow` are the tags and the description, for the
 * same reason: a `FieldRow` spends a fixed 140px on a label, which is the right
 * trade for a short value and the wrong one for the longest prose on the screen
 * — or for a strip of chips that says what it is by looking like one.
 *
 * The breadcrumb and the Details/History switcher are deliberately NOT here —
 * they live in the route wrapper (`EntityBreadcrumbBar`), which is what lets both
 * views share one frame without either owning it. Autosave is the shared
 * `useEntityDraftEditor` (500 ms, no Save button); deleting goes through the
 * host's `confirmDestructive` + `toast` events rather than a local `Dialog`.
 *
 * THE ONE LAYOUT REQUIREMENT THAT IS NOT COSMETIC. Everything that reaches the
 * model — the description, then the CONTRACT block (`server`, `params[]`,
 * `returns`, `sampleReturn`, the hints) — is visually separated from LOGIC,
 * which sits below its own rule. This is the only place the entity/L3 boundary
 * is visible to a human: everything above the separator transfers verbatim into
 * a tool definition in code, and everything below it does not travel at all. A
 * panel that interleaves them teaches the wrong thing on every read. The separation is a heading plus a real rule — not a bordered card,
 * which nothing else in this UI uses and which would therefore read as decoration.
 *
 * Colours are `var(--c-*)` tokens only, never literals.
 */

import type { CSSProperties, FC, ReactNode } from 'react';
import { Trash } from 'lucide-react';
import {
  useAssignTags,
  useEntityTags,
  useReferences,
  useRemoveEntityTag,
  useTags,
} from '@c4s/plugin-runtime';
import { ActionButton, DocEditor, FieldGrid, FieldRow, TagPicker } from '@c4s/plugin-runtime/ui';
import { MCP_TOOL_TYPE } from '../../../identity.js';
import { confirmDestructive, toast } from '../../../frontend-kit/host-events.js';
import { useEntityDraftEditor } from '../../../frontend-kit/useEntityDraftEditor.js';
import type { McpTool, McpToolHint, McpToolParam } from '../types.js';
import { MCP_TOOL_HINTS } from '../types.js';
import { readHint, toWritableHint } from './summary.js';
import { McpToolIcon } from './icon.js';
import { useDeleteMcpTool, useGetBySlug, useUpdateMcpTool } from './hooks.js';

export interface EntityDetailProps {
  slug: string;
  onDeleted?: () => void;
  onRenamed?: (newSlug: string) => void;
}

/**
 * The one control style this panel defines. The kit ships no Input component, so
 * every panel of this generation styles its own — borderless where the value is
 * short, hairline-bordered where it is a real text box (`ui-view` does the same
 * for its URL field). Sizes are the kit's: 13.5 for values, 12.5/11 for meta.
 */
const INPUT: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 8px',
  fontSize: 13.5,
  borderRadius: 4,
  border: '1px solid var(--c-hair)',
  background: 'transparent',
  color: 'var(--c-ink)',
  outline: 'none',
};
const MONO_INPUT: CSSProperties = { ...INPUT, fontFamily: 'var(--font-mono, monospace)' };

/** The uppercase mono heading that opens the Contract and Logic sections. */
const SectionHeading: FC<{ title: string; note: string }> = ({ title, note }) => (
  <div className="flex items-baseline gap-2 mb-3">
    <span
      className="font-mono text-[11px] uppercase tracking-wider"
      style={{ color: 'var(--c-subtle)' }}
    >
      {title}
    </span>
    <span className="text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
      {note}
    </span>
  </div>
);

/** The muted one-liner under a control that needs a word of guidance. */
const Hint: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="text-[11.5px] mt-1" style={{ color: 'var(--c-subtle)' }}>
    {children}
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
      className="rounded text-[11.5px] px-2 py-0.5"
      style={{
        border: '1px solid var(--c-hair)',
        background: state === id ? 'var(--c-accent-soft)' : 'transparent',
        color: state === id ? 'var(--c-ink)' : 'var(--c-muted)',
        fontWeight: state === id ? 600 : 400,
      }}
    >
      {text}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12.5px]" style={{ color: 'var(--c-ink)', minWidth: 96 }}>
        {label}
      </span>
      <div className="flex gap-1">
        {option('undeclared', 'Not declared', null)}
        {option('yes', 'Yes', true)}
        {option('no', 'No', false)}
      </div>
    </div>
  );
};

/**
 * The `params[]` editor — the flat reading of `inputSchema`. Local, like `dto`'s
 * `fields[]` editor: the kit has no table component, and a parameter row is this
 * type's own shape.
 */
const ParamsEditor: FC<{
  params: McpToolParam[];
  onChange: (next: McpToolParam[]) => void;
}> = ({ params, onChange }) => {
  const patch = (i: number, part: Partial<McpToolParam>) =>
    onChange(params.map((p, j) => (j === i ? { ...p, ...part } : p)));

  return (
    <div className="flex flex-col gap-1.5">
      {params.length === 0 ? (
        /*
          An empty list is a LEGAL and common state — an operation taking only a
          slug — so it says so rather than rendering nothing, which would read as
          "not described yet".
        */
        <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
          No parameters. This is a legal state, not a gap.
        </div>
      ) : null}

      {params.map((p, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
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
            className="flex items-center gap-1 text-[11.5px]"
            style={{ color: 'var(--c-muted)' }}
          >
            <input
              type="checkbox"
              checked={Boolean(p.required)}
              onChange={(e) => patch(i, { required: e.target.checked })}
            />
            req
          </label>
          <button
            type="button"
            onClick={() => onChange(params.filter((_, j) => j !== i))}
            className="rounded px-1"
            style={{ color: 'var(--c-muted)' }}
            title="Remove parameter"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex">
        <ActionButton
          label="Add parameter"
          variant="secondary"
          onClick={() => onChange([...params, { name: '', type: 'string' }])}
        />
      </div>
    </div>
  );
};

/**
 * Tags — host-owned, no plugin column, so they are NOT part of the draft: read
 * via `useEntityTags` (tag SLUGS), written via `useAssignTags` (whole-set, takes
 * tag NAMES, auto-creates missing ones) and `useRemoveEntityTag`.
 *
 * Nothing here is type-specific, and that is the point. An earlier revision made
 * this field police a `srv-{server}` tag mirroring the `server` field, warning
 * when the two disagreed. The mirror is gone: a tag is what an author picks to
 * embed a list with, and deriving one from a field turned a deliberate choice
 * into a rule that nothing could validate and that drifted silently.
 */
const TagsField: FC<{ slug: string }> = ({ slug }) => {
  const catalog = useTags();
  const entityTags = useEntityTags(MCP_TOOL_TYPE, slug);
  const assign = useAssignTags();
  const removeTag = useRemoveEntityTag();

  if (entityTags.data === undefined)
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
        Loading tags…
      </div>
    );

  const nameBySlug = new Map((catalog.data ?? []).map((t) => [t.slug, t] as const));
  const currentNames = entityTags.data.map((s) => nameBySlug.get(s)?.name ?? s);

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
      {error ? (
        <p role="alert" className="text-[11.5px] mt-1" style={{ color: 'var(--c-red, #c45a3b)' }}>
          {error}
        </p>
      ) : null}
    </>
  );
};

const ReferencesField: FC<{ slug: string }> = ({ slug }) => {
  const references = useReferences(MCP_TOOL_TYPE, slug);
  const hits = references.data ?? [];
  if (hits.length === 0)
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
        Not referenced by any page.
      </div>
    );
  return (
    <ul
      className="rounded-md"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
    >
      {hits.map((ref, i) => (
        <li
          key={`${ref.pagePath}:${ref.line}:${i}`}
          className="px-3 py-1.5 text-[12.5px] flex items-center gap-2"
          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--c-hair)' }}
        >
          <span className="font-mono" style={{ color: 'var(--c-ink)' }}>
            {ref.pagePath}
          </span>
          <span className="text-[10.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
            :{ref.line}
          </span>
          <span className="flex-1" />
          <span className="text-[10.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
            {ref.tagType}
          </span>
        </li>
      ))}
    </ul>
  );
};

/**
 * `updatedAt` reaches the client in one of TWO spellings, and the canonical
 * panels only handle one of them.
 *
 * They all write `new Date(updatedAt.replace(' ', 'T') + 'Z')`, which is right
 * for SQLite's `YYYY-MM-DD HH:MM:SS` and wrong for the full ISO string the API
 * returns today — appending a second `Z` yields `Invalid Date`, which is what
 * every entity detail panel in this build currently prints. Reported upstream;
 * accepting both spellings here rather than reproducing the bug for symmetry.
 */
function formatUpdatedAt(raw: unknown): string {
  const text = String(raw ?? '');
  if (!text) return 'never';
  const iso = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? text
    : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function messageOf(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : 'Update failed';
}

interface Draft {
  name: string;
  server: string;
  description: string;
  params: McpToolParam[];
  returns: string;
  sampleReturn: string;
  readOnlyHint: McpToolHint;
  destructiveHint: McpToolHint;
  idempotentHint: McpToolHint;
  openWorldHint: McpToolHint;
  logic: string;
}

/** Module-level and pure — `useEntityDraftEditor` requires a stable reference. */
function toDraft(t: McpTool): Draft {
  return {
    name: t.name,
    server: t.server,
    description: t.description,
    params: t.params ?? [],
    returns: t.returns ?? '',
    sampleReturn: t.sampleReturn ?? '',
    readOnlyHint: toWritableHint(t.readOnlyHint as McpToolHint | 0 | 1),
    destructiveHint: toWritableHint(t.destructiveHint as McpToolHint | 0 | 1),
    idempotentHint: toWritableHint(t.idempotentHint as McpToolHint | 0 | 1),
    openWorldHint: toWritableHint(t.openWorldHint as McpToolHint | 0 | 1),
    logic: t.logic ?? '',
  };
}

export const McpToolDetail: FC<EntityDetailProps> = ({ slug, onDeleted, onRenamed }) => {
  const { data: tool, isLoading, error } = useGetBySlug(slug);
  const update = useUpdateMcpTool();
  const remove = useDeleteMcpTool();

  const { draft, dirty, patch } = useEntityDraftEditor<McpTool, Draft>({
    entity: tool,
    toDraft,
    save: async (current, entity) => {
      const updated = await update.mutateAsync({
        slug: entity.slug,
        body: {
          name: current.name,
          server: current.server,
          description: current.description,
          params: current.params,
          // A cleared optional is `null`, never `''` — the schema marks these
          // `clearable`, and an empty string would file "undescribed" as
          // "described as nothing".
          returns: current.returns || null,
          sampleReturn: current.sampleReturn || null,
          readOnlyHint: current.readOnlyHint ?? null,
          destructiveHint: current.destructiveHint ?? null,
          idempotentHint: current.idempotentHint ?? null,
          openWorldHint: current.openWorldHint ?? null,
          logic: current.logic || null,
        },
      });
      if (updated.slug !== entity.slug) onRenamed?.(updated.slug);
      return updated;
    },
  });

  async function handleDelete() {
    if (!tool) return;
    const ok = await confirmDestructive({
      title: 'Delete this tool?',
      body: `Delete ${tool.slug}? The description of the tool goes with it; the tool itself, wherever it is mounted, is untouched.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ slug: tool.slug });
      onDeleted?.();
      toast.success(`MCP tool ${tool.slug} deleted`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (isLoading && !tool)
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading MCP tool…
      </div>
    );
  if (error)
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-red)' }}>
        Failed to load: {(error as Error).message}
      </div>
    );
  // `useGetBySlug` turns a 404 into `null` on purpose, so this arm is reachable
  // and says which slug missed rather than rendering an empty screen.
  if (tool === null)
    return (
      <div className="p-8 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        No MCP tool at <code>{slug}</code>.
      </div>
    );
  if (!tool || !draft) return null;

  const saveError = messageOf(update.error);

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <FieldGrid maxWidth={740}>
        <div
          className="flex items-center gap-2 mb-1 text-[11px]"
          style={{ color: 'var(--c-subtle)' }}
        >
          <span className="font-mono">{tool.slug}</span>
          <span>·</span>
          <span>updated {formatUpdatedAt(tool.updatedAt)}</span>
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

        {/*
          The title is `name` — the tool's identifier on the wire, and the only
          field of this type that reads as the record's name. Editing it does NOT
          move the slug: the pattern runs once, at create. That is said in the
          meta line rather than under the control, because it is a fact about the
          slug sitting three inches to the left, not about this input.
        */}
        <div className="flex items-center gap-2 mt-2 mb-1">
          <McpToolIcon size={22} style={{ color: 'var(--c-accent)' }} />
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="flex-1 bg-transparent outline-none font-mono"
            style={{ fontSize: 22, fontWeight: 600, color: 'var(--c-ink)' }}
            placeholder="tool_name"
            spellCheck={false}
          />
        </div>
        <div className="text-[11px] mb-2" style={{ color: 'var(--c-subtle)' }}>
          Renaming the tool does not rename the entity — the slug is fixed at create.
        </div>

        {saveError ? (
          <p role="alert" className="text-[12px]" style={{ color: 'var(--c-red, #c45a3b)' }}>
            {saveError}
          </p>
        ) : null}

        {/*
          Tags come FIRST, before anything domain-specific, and with NO label —
          flush left, the way `database-table` and every host built-in render
          them. A chip strip says what it is by looking like one, and a `TAGS`
          column would spend 140px announcing it.

          They are also the one field on this screen that is not about MCP at
          all: they are how an author groups the record and how a page embeds it.
        */}
        <TagsField slug={tool.slug} />

        {/*
          ── THE DESCRIPTION ─────────────────────────────────────────────
          Second under the title, and the full width of the grid rather than a
          `FieldRow` — a `FieldRow` spends 140px on a label this field does not
          need, and this is the longest prose on the screen. That is the shape
          `database-table` gives its description: heading above, editor below.

          `DocEditor`, not a textarea. An earlier revision argued the opposite —
          that this string travels verbatim into a tool definition, so a markdown
          editor would add formatting nobody asked for. Tool descriptions ARE
          markdown in practice and the model reads them as such, so the editor is
          the right control; what survives from that argument is the narrower
          caution below, about what the field must NOT contain.
        */}
        <div className="mt-6">
          <SectionHeading title="Description" note="goes to the model verbatim" />
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="What the tool does, and when a model should reach for it…"
          />
          <Hint>
            No spec anchors, page names or module numbers — a description that needs the
            specification to be understood is not one a model can act on. Max 2000 characters.
          </Hint>
        </div>

        {/*
          `Server` sits between the description and the contract because that is
          what it is: not prose, and not part of what the tool DOES — a grouping
          label that happens to be half of `mcp__{server}__{name}`.
        */}
        <div className="mt-6">
          <FieldRow label="Server">
            <input
              value={draft.server}
              onChange={(e) => patch({ server: e.target.value })}
              style={MONO_INPUT}
              spellCheck={false}
            />
            <Hint>The {'{server}'} of mcp__{'{server}'}__{'{name}'}, and half of the slug.</Hint>
          </FieldRow>
        </div>

        {/*
          ── THE CONTRACT ────────────────────────────────────────────────
          Everything in this block transfers verbatim into the tool definition in
          code. The heading says so, because that is the fact a reader needs
          before deciding what may be written here.
        */}
        <div className="mt-6">
          <SectionHeading
            title="Contract"
            note="transferred verbatim into the tool definition"
          />

          <div>
            <FieldRow label="Parameters" align="start">
              <ParamsEditor params={draft.params} onChange={(params) => patch({ params })} />
            </FieldRow>
          </div>

          <div className="mt-4">
            <FieldRow label="Returns" align="start">
              <textarea
                value={draft.returns}
                onChange={(e) => patch({ returns: e.target.value })}
                rows={2}
                style={{ ...INPUT, resize: 'vertical' }}
              />
              <Hint>The payload only — never the content[] / isError envelope.</Hint>
            </FieldRow>
          </div>

          <div className="mt-4">
            <FieldRow label="Sample return" align="start">
              <textarea
                value={draft.sampleReturn}
                onChange={(e) => patch({ sampleReturn: e.target.value })}
                rows={3}
                style={{ ...MONO_INPUT, resize: 'vertical' }}
              />
              <Hint>
                Only for a return that is nested or carries an array of objects. A flat return
                belongs in Returns.
              </Hint>
            </FieldRow>
          </div>

          <div className="mt-4">
            <FieldRow label="Annotations" align="start">
              <div className="flex flex-col gap-1.5">
                {MCP_TOOL_HINTS.map(({ key, label }) => (
                  <HintControl
                    key={key}
                    label={label}
                    value={draft[key] as McpToolHint}
                    onChange={(next) => patch({ [key]: next } as Partial<Draft>)}
                  />
                ))}
              </div>
              <Hint>
                Hints, not guarantees — a client must treat them as untrusted. No gate may rest
                on them.
              </Hint>
            </FieldRow>
          </div>
        </div>

        {/*
          ── THE LOGIC ───────────────────────────────────────────────────
          Below a real rule, because none of this travels: it is not part of the
          tool definition and is never sent to a model. The visual break is the
          only place this boundary is legible to a human, which is why it is a
          separation and not just another heading.
        */}
        <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--c-hair)' }}>
          <SectionHeading title="Logic" note="never sent to the model" />
          {/*
            A textarea, not `DocEditor`, and this one is a deliberate departure
            from the other panels of this generation — they give their long prose
            field the markdown editor.

            `DocEditor` normalises its content through tiptap and emits `onChange`
            on MOUNT when the normalisation differs from the stored string. Under
            an autosaving panel that means merely OPENING a tool writes it: a new
            version, a new `updatedAt`, a line in the release diff, for a visit.
            `logic` is a capped 1000 characters of implementation prose, so the
            editor buys formatting nobody needs at the price of a write per view.
          */}
          <FieldRow label="Logic" align="start">
            <textarea
              value={draft.logic}
              onChange={(e) => patch({ logic: e.target.value })}
              rows={6}
              style={{ ...INPUT, resize: 'vertical' }}
            />
            <Hint>
              Never sent to the model. Max 1000 characters — {draft.logic.length} / 1000.
            </Hint>
          </FieldRow>
        </div>

        <div className="mt-6">
          <FieldRow label="Find references" align="start">
            <ReferencesField slug={tool.slug} />
          </FieldRow>
        </div>
      </FieldGrid>
    </div>
  );
};
