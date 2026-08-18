/**
 * `detailPanel` — the REQUIRED frontend slot, and the only one that is a SCREEN.
 * Everything else (chip/card/row) is a pure embed and the list is a composition;
 * this panel is the one surface that resolves an entity, holds a draft, calls
 * mutations and draws loading / absent / data
 * (`ac-panel-detalu-sam-wola-usegetbyslug-slug`).
 *
 * Props contract: `EntityDetailProps = { slug; onDeleted?; onRenamed? }`. The host
 * injects ONLY `slug`. `onDeleted?`/`onRenamed?` are optional panel→host
 * notifications; `onRenamed?(newSlug)` fires ONLY when a save actually moved the
 * slug (a rename goes exclusively through `newSlug`, never through editing
 * `title` alone). There is deliberately NO `onBack`, no `onOpenEntity`, no `onOpenPage`:
 * back is the host breadcrumb, and cross-entity navigation goes through the
 * `useEditorBridge()` / `editorBridge` singleton.
 *
 * The panel calls `useGetBySlug(slug)` ITSELF and discriminates three states:
 * `undefined` → `LoadingState`, `null` → `EmptyState`, otherwise the editable
 * form. The WRITE side is built by the plugin — the host ships no save path — so
 * saving is `useUpdateDatabaseTable` on a 500ms debounce (live autosave, no Save
 * button). A `currentSlugRef` tracks the live slug across successive renames so a
 * rapid edit-after-rename still PATCHes the right URL before the host remounts
 * the panel via `key={slug}`.
 *
 * This is the single real editing surface for a table: TITLE (which for this type
 * IS the SQL identifier), COLUMNS and INDEXES.
 * `fk` is soft — pointing a column at a table that does not exist is a warning on
 * the mutation response, never a client-side error, so the editor never blocks it.
 *
 * Layout: plugin-owned "above-header strip" under the title (`slug`, `updatedAt`,
 * `dirty`/`saving`) — it holds no delete action of its own in the spec's doctrine,
 * but the host's `EntityDetailToolbar` cannot produce "large title, then a
 * separate slug/date row", so the destructive delete lives at the end of that
 * strip behind a plugin-owned confirm `Dialog`. `DetailPanelShell` takes no
 * `title` (the last breadcrumb crumb is the title) and scrolls its own children.
 *
 * Details and History are TWO SIBLING ROUTES (`$slug` and `$slug/history`), not an
 * in-panel tab: `onSwitchView` is real router navigation built in `routes.tsx`, so
 * History is deep-linkable and Back does not land on a stale view.
 * `onBackToList`/`onSwitchView` are NOT host props — they are plugin-internal
 * wiring supplied by the route wrapper, the one layer that holds `useNavigate`.
 *
 * Back-links come from the host's `useReferences`. History is NOT composed here:
 * it is the host's shared `EntityVersionHistoryView` block — the same one
 * `endpoint`/`dto` and the host's own built-in routes render — given nothing but
 * `type` + `slug`. That is the point of the parity guarantee (M13 / M34): one
 * component for host and plugins, so the view cannot drift per entity type. This
 * panel only supplies the surrounding frame.
 * Tags are host-owned: read through `useEntityTags`, written through the host's
 * own routes, picked with the kit's `TagPicker`.
 *
 * Colours are `var(--c-*)` tokens only — never literals.
 */

import type { CSSProperties, FC, ReactNode } from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
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
  DocEditor,
  EmptyState,
  EntityVersionHistoryView,
  LoadingState,
  SegmentedControlTabs,
  TagPicker,
} from '@c4s/plugin-runtime/ui';
import { DATABASE_TABLE_LABEL_PLURAL, DATABASE_TABLE_TYPE, slugify } from '../../../identity.js';
import type {
  Column,
  DatabaseTableResponse,
  DatabaseTableUpdateInput,
  Index,
} from '../types.js';
import { useDeleteDatabaseTable, useGetBySlug, useUpdateDatabaseTable } from './hooks.js';

/** Entity detail's two sibling views — mirrors the host's own Details/History split. */
type EntityView = 'details' | 'history';

/** Real router navigation between the Details/History sibling routes — see `routes.tsx`. */
type SwitchView = (view: EntityView, opts?: { replace?: boolean }) => void;

/**
 * The 1.1.0 props contract, declared locally: the installed `@c4s/plugin-runtime`
 * still ships the 1.0.0 `EntityDetailProps` (required `onBack`).
 * `onBackToList`/`onSwitchView` are plugin-internal, not host-injected.
 */
type EntityDetailProps = {
  slug: string;
  onDeleted?: () => void;
  onRenamed?: (newSlug: string) => void;
  onBackToList?: () => void;
  onSwitchView?: SwitchView;
};

/**
 * The editable shape of a table: its title — which for this type IS the SQL
 * identifier — its table-level prose, plus its two ordered lists. `description`
 * has to be in the draft AND in the PATCH body — it was absent from both, so the
 * field was invisible and unsavable even though the update contract has accepted
 * it all along.
 */
type Draft = { title: string; description: string; columns: Column[]; indexes: Index[] };

const AUTOSAVE_DELAY_MS = 500;

const ERROR_STYLE: CSSProperties = { color: 'var(--c-red)', fontSize: 12.5, margin: 0 };

const MUTED_STYLE: CSSProperties = { color: 'var(--c-subtle)', fontSize: 12.5 };

// Matches the host's own entity detail pages: a centered, width-constrained
// column — not full-bleed — so this page reads consistently with the rest of the app.
const HEADER_WRAP_STYLE: CSSProperties = {
  margin: '0 auto',
  maxWidth: 960,
  padding: '48px 56px 0',
};

const TITLE_TEXTAREA_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 'none',
  outline: 'none',
  resize: 'none',
  overflow: 'hidden',
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 26,
  fontWeight: 600,
  color: 'var(--c-ink)',
};

// The plugin-owned strip directly under the title: slug + updated-date +
// saving/edited indicator, with Delete pushed to the far right by the spacer.
const META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--c-subtle)',
  marginTop: 8,
  marginBottom: 16,
};

const DELETE_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--c-red)',
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 4,
};

// Matches the host's own `SectionLabel` exactly (identical in `ac` and
// `design-system`'s detail pages) — no bold, `10.5px`, not `11px`.
const SECTION_HEADING_STYLE: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--c-subtle)',
  margin: '0 0 8px',
};

// A section laid out label-left instead of label-above — the host's `FieldRow
// align="start"` (`host-ui-kit/core/FieldRow.tsx`): 140px mono label column,
// content taking the rest. Used by "Found references".
const LABEL_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-start',
};

const LABEL_ROW_LABEL_STYLE: CSSProperties = {
  ...SECTION_HEADING_STYLE,
  margin: 0,
  width: 140,
  flexShrink: 0,
  paddingTop: 2,
};

/** The bordered card holding the reference hits — one `<li>` per referrer. */
const REFERENCE_CARD_STYLE: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  borderRadius: 6,
  border: '1px solid var(--c-hair)',
  background: 'var(--c-card)',
};

const REFERENCE_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  fontSize: 12.5,
  color: 'var(--c-ink)',
};

/** The dim mono satellites of a hit: `:line` on the left, `tagType` on the right. */
const REFERENCE_META_STYLE: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 10.5,
  color: 'var(--c-subtle)',
};

// Same `960`/`56px` column as `HEADER_WRAP_STYLE` — `DetailPanelShell`'s body
// itself has no padding at all.
const CONTENT_WRAP_STYLE: CSSProperties = {
  margin: '0 auto',
  maxWidth: 960,
  padding: '0 56px 56px',
};

/*
 * The columns/indexes editors read like the host's own field grid
 * (`claude4spec/src/client/entities/dto/detail-panel.tsx:215-282`): one bordered
 * `--c-panel` container, a mono uppercase header row, then data rows, cells being
 * BARE transparent inputs. The container's border plus the header row carry the
 * structure, so per-cell boxes would only add noise.
 *
 * They are real `<table>`s. Built out of grid divs, a row separator could not span
 * the table: a block child sizes against the scroll CONTAINER, so every border
 * stopped at the panel edge while the header — sized `max-content` — ran on past
 * it.
 */
const EDITOR_TABLE_STYLE: CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--c-hair)',
  background: 'var(--c-panel)',
  // The scrolling viewport. The table inside is wider than the panel by design
  // (eight fixed columns), so the overflow becomes a scrollbar instead of
  // squeezing the cells until the headings collide.
  overflowX: 'auto',
};

/**
 * A REAL `<table>`, not a stack of grid divs. The div version could not draw a
 * row separator correctly: a block child's width resolves against the scroll
 * CONTAINER, so every row border stopped at the panel edge instead of running to
 * the end of the (wider) table. Table rows have no such problem — the row box is
 * as wide as the table.
 *
 * `tableLayout: fixed` + the `<colgroup>` widths make the columns deterministic;
 * `minWidth` is the sum of those widths, so the table keeps them and scrolls
 * rather than collapsing when the panel is narrower.
 */
const EDITOR_GRID_TABLE_STYLE: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
};

/**
 * Every text column is sized to its own longest value rather than to a fixed
 * number. This has to be measured in JS: `table-layout: fixed` never consults
 * content, and even `auto` would not help — an `<input>`'s intrinsic width comes
 * from its `size` attribute, not from the text inside it. Every cell here is
 * monospace, which makes character count an exact proxy for width.
 *
 * Only the two non-text columns keep a constant: `flags` (three checkboxes) and
 * the remove button. The unpredictable field — `description` — is not in the grid
 * at all; it has its own full-width row, which is what makes sizing the rest to
 * content safe.
 *
 * Clamped at both ends: the floor is the column's own HEADING (a column never
 * gets narrower than its label), the ceiling stops one long value from pushing
 * everything else off into the horizontal scroll.
 */
const CELL_CHAR_PX = 7.5; // monospace advance at the cells' 12.5px
const HEAD_CHAR_PX = 7; // ditto at the heading's 10.5px + its letter-spacing
const CELL_PADDING_PX = 20; // the `10px` left+right of `EDITOR_CELL_STYLE`
const MAX_CELL_WIDTH = 260;
const FLAGS_WIDTH = 150;
const UNIQ_FLAG_WIDTH = 90;
const REMOVE_WIDTH = 28;

/**
 * Width fitting the longest of `values`, never below what `heading` needs.
 * Placeholders count as values — a column showing `column_name` in grey should
 * be wide enough for it, so the layout does not jump once it is filled in.
 */
function contentWidth(heading: string, values: string[]): number {
  const longest = values.reduce((widest, value) => Math.max(widest, value.length), 0);
  const floor = Math.round(heading.length * HEAD_CHAR_PX) + CELL_PADDING_PX;
  return Math.min(
    MAX_CELL_WIDTH,
    Math.max(floor, Math.round(longest * CELL_CHAR_PX) + CELL_PADDING_PX),
  );
}

const sumWidths = (widths: number[]): number => widths.reduce((a, b) => a + b, 0);

const EDITOR_HEAD_CELL_STYLE: CSSProperties = {
  textAlign: 'left',
  fontWeight: 400,
  padding: '6px 10px',
  fontFamily: 'monospace',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--c-subtle)',
  borderBottom: '1px solid var(--c-hair)',
};

const EDITOR_CELL_STYLE: CSSProperties = {
  padding: '5px 10px',
  verticalAlign: 'middle',
};

/**
 * The description line — its own `<tr>` spanning every column, so the separator
 * under it runs the full table width. The cell is as wide as the table, but the
 * prose inside is capped and `sticky`, so it stays readable at panel width
 * instead of trailing off into the horizontal scroll.
 */
const COLUMN_DESCRIPTION_CELL_STYLE: CSSProperties = {
  padding: '0 10px 6px',
};

const COLUMN_DESCRIPTION_INNER_STYLE: CSSProperties = {
  position: 'sticky',
  // 10px, not 0 — the cell's own left padding stops applying once the sticky box
  // pins, and flush against the container edge it read as a misalignment.
  left: 10,
  maxWidth: 720,
};

const CELL_INPUT_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 12.5,
  fontFamily: 'monospace',
  color: 'var(--c-ink)',
};

/** Secondary cells on the continuation line — prose, so not mono, and dimmer. */
const CELL_PROSE_STYLE: CSSProperties = {
  ...CELL_INPUT_STYLE,
  fontFamily: 'inherit',
  fontSize: 12,
  color: 'var(--c-muted)',
};

const EMPTY_HINT_STYLE: CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  color: 'var(--c-subtle)',
};

const FLAG_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 11,
  color: 'var(--c-subtle)',
  whiteSpace: 'nowrap',
};

const ADD_BUTTON_STYLE: CSSProperties = {
  border: '1px solid var(--c-hair)',
  background: 'transparent',
  color: 'var(--c-muted)',
  borderRadius: 4,
  fontSize: 11.5,
  padding: '3px 8px',
  cursor: 'pointer',
  marginTop: 6,
};

const REMOVE_BUTTON_STYLE: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--c-subtle)',
  cursor: 'pointer',
  fontSize: 12,
  padding: '0 4px',
};

/** `MutationLike.error`/`mutate` are host-declared as `unknown`/single-arg — narrow defensively. */
function mutationErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : 'Tag update failed';
}

/**
 * Tags — host-owned, no plugin column. Read via `useEntityTags` (returns tag
 * SLUGS); written via `useAssignTags` (whole-set, takes tag NAMES, auto-creates
 * missing ones) and `useRemoveEntityTag`. Rendered through the kit's `TagPicker`
 * in the `collapsed` variant, matching every built-in entity, and as a BARE row
 * with no section heading — no built-in entity labels it either.
 */
const TagsField: FC<{ slug: string }> = ({ slug }) => {
  const catalog = useTags();
  const entityTags = useEntityTags(DATABASE_TABLE_TYPE, slug);
  const assign = useAssignTags();
  const removeTag = useRemoveEntityTag();

  if (entityTags.data === undefined) return <span style={MUTED_STYLE}>Loading tags…</span>;

  const nameBySlug = new Map((catalog.data ?? []).map((t) => [t.slug, t] as const));
  const currentNames = entityTags.data.map((s) => nameBySlug.get(s)?.name ?? s);

  const handleToggle = (tagSlug: string) => {
    if (entityTags.data!.includes(tagSlug)) {
      removeTag.mutate({ type: DATABASE_TABLE_TYPE, slug, tagSlug });
      return;
    }
    const name = nameBySlug.get(tagSlug)?.name ?? tagSlug;
    assign.mutate({ type: DATABASE_TABLE_TYPE, slug, tags: [...currentNames, name] });
  };

  const handleCreate = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || assign.isPending) return;
    const isDuplicate = currentNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) return;
    assign.mutate({ type: DATABASE_TABLE_TYPE, slug, tags: [...currentNames, trimmed] });
  };

  const errorMessage = mutationErrorMessage(assign.error) ?? mutationErrorMessage(removeTag.error);

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
      {errorMessage ? (
        <p role="alert" style={ERROR_STYLE}>
          {errorMessage}
        </p>
      ) : null}
    </>
  );
};

/**
 * Found references — back-links via the host's generic `useReferences` (bound to
 * `GET /api/references?type=&slug=`).
 *
 * Rendered as the host's OWN references row rather than the kit's
 * `ReferencesList`: label in a fixed left column, hits in one bordered card,
 * each line `pagePath` · `:line` · spacer · `tagType`
 * (`claude4spec/src/client/entities/dto/detail-panel.tsx:337-368`). The kit
 * component draws a different shape (label above, file icon, one glued
 * `path:line` string) and this panel is supposed to read like a native entity
 * page. The layout of `LABEL_ROW_*` is exactly what the kit's `FieldRow
 * align="start"` produces — reproduced inline because the panel styles
 * everything inline and carries no Tailwind.
 *
 * The path is deliberately NOT a link: the host navigates with
 * `onOpenPage(rootId, pagePath)`, but the published `editorBridge` offers only
 * `openEntity` / `openSection(pagePath, anchor)` — and a `ReferenceHit` carries
 * no anchor.
 */
const ReferencesSection: FC<{ slug: string }> = ({ slug }) => {
  const references = useReferences(DATABASE_TABLE_TYPE, slug);
  const hits = references.data ?? [];

  if (references.isLoading) return <LoadingState lines={3} />;
  if (hits.length === 0) {
    return <div style={{ fontSize: 12.5, color: 'var(--c-subtle)' }}>Not referenced by any page.</div>;
  }

  return (
    <ul style={REFERENCE_CARD_STYLE}>
      {hits.map((ref, i) => (
        <li
          key={`${ref.pagePath}:${ref.line}:${i}`}
          style={{
            ...REFERENCE_ITEM_STYLE,
            borderTop: i === 0 ? 'none' : '1px solid var(--c-hair)',
          }}
        >
          <span style={{ fontFamily: 'monospace' }}>{ref.pagePath}</span>
          <span style={REFERENCE_META_STYLE}>:{ref.line}</span>
          <span style={{ flex: 1 }} />
          <span style={REFERENCE_META_STYLE}>{ref.tagType}</span>
        </li>
      ))}
    </ul>
  );
};

/** A section whose heading sits in a fixed left column — the host's `FieldRow`. */
const LabelledRow: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div style={LABEL_ROW_STYLE}>
    <div style={LABEL_ROW_LABEL_STYLE}>{label}</div>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
);

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Shared frame between the Details and History routes — `DetailPanelShell` plus
 * the `SegmentedControlTabs` toggle. `onSwitchView` is real router navigation, so
 * clicking the already-active tab is a guarded no-op.
 */
const DatabaseTableDetailShell: FC<{
  slug: string;
  activeView: EntityView;
  onBackToList?: () => void;
  onSwitchView?: SwitchView;
  children: ReactNode;
}> = ({ slug, activeView, onBackToList, onSwitchView, children }) => (
  <DetailPanelShell
    breadcrumb={[{ label: DATABASE_TABLE_LABEL_PLURAL, onClick: onBackToList }, { label: slug }]}
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

export const DatabaseTableDetail: FC<EntityDetailProps> = ({
  slug,
  onDeleted,
  onRenamed,
  onBackToList,
  onSwitchView,
}) => {
  // The panel resolves the entity ITSELF — the host injects only the slug.
  const { data: entity } = useGetBySlug(slug);

  // Three states — `undefined` = not yet resolved, `null` = resolved-but-absent.
  if (entity === undefined) return <LoadingState lines={6} />;
  if (entity === null) {
    return <EmptyState title="Not found" hint={<code>{slug}</code>} />;
  }
  // The inner form seeds its draft/baseline once from `entity` via `useState`; the
  // route's `key={slug}` guarantees a fresh mount (and fresh draft) per entity.
  return (
    <DatabaseTableDetailForm
      entity={entity}
      onDeleted={onDeleted}
      onRenamed={onRenamed}
      onBackToList={onBackToList}
      onSwitchView={onSwitchView}
    />
  );
};

/**
 * History route's own component — no `useGetBySlug` fetch (the breadcrumb only
 * ever needs `slug`, already the route param), so a deep-link to history for a
 * nonexistent slug won't show the Details route's "Not found" `EmptyState` —
 * accepted gap for v1.
 */
export const DatabaseTableHistory: FC<{
  slug: string;
  onBackToList?: () => void;
  onSwitchView?: SwitchView;
}> = ({ slug, onBackToList, onSwitchView }) => (
  // The shell is the plugin's outer chrome (breadcrumb + Details/History tabs) —
  // the counterpart of `EntityBreadcrumbBar` in `c4s-plugin-api-contracts`. What
  // it wraps is NOT plugin code: `EntityVersionHistoryView` fetches the versions,
  // the snapshots and the release labels itself and renders the whole view from
  // `type` + `slug` alone. Selection, compare target, diff, restore and the
  // loading/empty states all live in the block, so there is deliberately no local
  // state here — a hand-rolled pane is exactly the drift this replaced.
  <DatabaseTableDetailShell
    slug={slug}
    activeView="history"
    onBackToList={onBackToList}
    onSwitchView={onSwitchView}
  >
    <EntityVersionHistoryView
      type={DATABASE_TABLE_TYPE}
      slug={slug}
      onRestored={() => onSwitchView?.('details', { replace: true })}
    />
  </DatabaseTableDetailShell>
);

const Flag: FC<{ label: string; checked?: boolean; onChange: (next: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <label style={FLAG_STYLE}>
    <input
      type="checkbox"
      checked={Boolean(checked)}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
    />
    {label}
  </label>
);

/**
 * Columns editor — the ordered `columns[]`, position preserved (the order is
 * meaningful: `snapshot()` is byte-stable on it). `fk` is SOFT: a target table
 * that does not exist is a server-side WARNING, so nothing here validates it.
 */
const COLUMN_HEADINGS = [
  'name',
  'type',
  'default',
  'enum values',
  'flags',
  'fk table',
  'fk column',
  '',
];

/**
 * `default` is modelled as `unknown` (it is "the default as written in the schema"),
 * but the editor is a text box — so round-trip it as a string and treat an empty box
 * as "no default" rather than as the empty string.
 */
function defaultToText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

/** The canonical parse of a comma-separated list cell (`enumValues`, `Index.columns`). */
function parseCommaList(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * A textarea that grows with its content instead of clipping it — the column
 * description used to be an `<input>`, so anything longer than its cell was
 * simply invisible. Same auto-grow effect the title and the table description
 * already use.
 */
const AutoGrowTextarea: FC<{
  value: string;
  ariaLabel: string;
  placeholder?: string;
  onChange: (next: string) => void;
  style?: CSSProperties;
}> = ({ value, ariaLabel, placeholder, onChange, style }) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ resize: 'none', overflow: 'hidden', lineHeight: 1.45, ...style }}
    />
  );
};

/**
 * A text cell editing a LIST written with commas — `enumValues` and an index's
 * `columns`.
 *
 * It keeps its own text buffer instead of deriving `value` from the parsed
 * array, and that is the whole point: driving the box straight off
 * `values.join(', ')` meant every keystroke round-tripped through
 * `split(',').map(trim).filter(Boolean)`, so a freshly typed comma (and the
 * space after it) was erased in the same render — a second value could not even
 * be started. The parse still runs on every change and flows UP; only the
 * display text is left alone.
 *
 * The buffer re-seeds when the incoming list stops matching what the buffer
 * parses to — a version restore or any other outside write — but never on this
 * component's own edit, so the effect cannot fight the typing.
 */
const CommaListInput: FC<{
  values: string[];
  ariaLabel: string;
  placeholder?: string;
  onChange: (next: string[]) => void;
  style?: CSSProperties;
}> = ({ values, ariaLabel, placeholder, onChange, style }) => {
  const [text, setText] = useState(() => values.join(', '));
  const canonical = values.join('\u0000');

  useEffect(() => {
    setText((current) =>
      parseCommaList(current).join('\u0000') === canonical ? current : values.join(', '),
    );
    // `canonical` is the identity of the incoming list — `values` itself is a
    // fresh array on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical]);

  return (
    <input
      value={text}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseCommaList(e.target.value));
      }}
      style={style}
    />
  );
};

const ColumnsEditor: FC<{ columns: Column[]; onChange: (next: Column[]) => void }> = ({
  columns,
  onChange,
}) => {
  const patchAt = (index: number, partial: Partial<Column>) =>
    onChange(columns.map((c, i) => (i === index ? { ...c, ...partial } : c)));

  // Every text column follows its content — recomputed from the draft, so the
  // columns grow and shrink while typing.
  const widths = [
    contentWidth('name', [...columns.map((c) => c.name), 'column_name']),
    contentWidth('type', [...columns.map((c) => c.type), 'text']),
    contentWidth('default', columns.map((c) => defaultToText(c.default))),
    contentWidth('enum values', columns.map((c) => (c.enumValues ?? []).join(', '))),
    FLAGS_WIDTH,
    contentWidth('fk table', columns.map((c) => c.fk?.table ?? '')),
    contentWidth('fk column', columns.map((c) => c.fk?.column ?? '')),
    REMOVE_WIDTH,
  ];

  return (
    <div>
      <div style={EDITOR_TABLE_STYLE}>
        <table style={{ ...EDITOR_GRID_TABLE_STYLE, minWidth: sumWidths(widths) }}>
          <colgroup>
            {widths.map((width, i) => (
              <col key={i} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMN_HEADINGS.map((heading, i) => (
                <th key={i} scope="col" style={EDITOR_HEAD_CELL_STYLE}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_HEADINGS.length} style={EMPTY_HINT_STYLE}>
                  No columns yet.
                </td>
              </tr>
            ) : (
              columns.map((column, index) => (
                <Fragment key={index}>
                  <tr>
                    <td style={EDITOR_CELL_STYLE}>
                      <input
                        value={column.name}
                        aria-label={`Column ${index + 1} name`}
                        placeholder="column_name"
                        onChange={(e) => patchAt(index, { name: e.target.value })}
                        style={CELL_INPUT_STYLE}
                      />
                    </td>
                    <td style={EDITOR_CELL_STYLE}>
                      <input
                        value={column.type}
                        aria-label={`Column ${index + 1} type`}
                        placeholder="text"
                        onChange={(e) => patchAt(index, { type: e.target.value })}
                        style={CELL_INPUT_STYLE}
                      />
                    </td>
                    <td style={EDITOR_CELL_STYLE}>
                      <input
                        value={defaultToText(column.default)}
                        aria-label={`Column ${index + 1} default`}
                        placeholder="—"
                        onChange={(e) =>
                          patchAt(index, {
                            default: e.target.value === '' ? undefined : e.target.value,
                          })
                        }
                        style={CELL_INPUT_STYLE}
                      />
                    </td>
                    <td style={EDITOR_CELL_STYLE}>
                      <CommaListInput
                        values={column.enumValues ?? []}
                        ariaLabel={`Column ${index + 1} enum values`}
                        placeholder="a, b"
                        // An emptied cell means "not an enumeration" — store
                        // nothing rather than an empty array.
                        onChange={(next) =>
                          patchAt(index, { enumValues: next.length ? next : undefined })
                        }
                        style={CELL_INPUT_STYLE}
                      />
                    </td>
                    <td style={EDITOR_CELL_STYLE}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Flag
                          label="pk"
                          checked={column.pk}
                          onChange={(next) => patchAt(index, { pk: next || undefined })}
                        />
                        <Flag
                          label="null"
                          checked={column.nullable}
                          onChange={(next) => patchAt(index, { nullable: next || undefined })}
                        />
                        <Flag
                          label="uniq"
                          checked={column.unique}
                          onChange={(next) => patchAt(index, { unique: next || undefined })}
                        />
                      </div>
                    </td>
                    <td style={EDITOR_CELL_STYLE}>
                      <input
                        value={column.fk?.table ?? ''}
                        aria-label={`Column ${index + 1} fk table`}
                        placeholder="—"
                        onChange={(e) =>
                          patchAt(index, {
                            fk: e.target.value
                              ? { table: e.target.value, column: column.fk?.column ?? '' }
                              : undefined,
                          })
                        }
                        style={CELL_INPUT_STYLE}
                      />
                    </td>
                    <td style={EDITOR_CELL_STYLE}>
                      <input
                        value={column.fk?.column ?? ''}
                        aria-label={`Column ${index + 1} fk column`}
                        placeholder="—"
                        disabled={!column.fk}
                        onChange={(e) =>
                          patchAt(index, {
                            fk: { table: column.fk?.table ?? '', column: e.target.value },
                          })
                        }
                        style={CELL_INPUT_STYLE}
                      />
                    </td>
                    <td style={EDITOR_CELL_STYLE}>
                      <button
                        type="button"
                        title={`Remove column ${index + 1}`}
                        onClick={() => onChange(columns.filter((_, i) => i !== index))}
                        style={REMOVE_BUTTON_STYLE}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                  {/* The description gets a row of its own spanning every column,
                      so the separator under it runs the FULL table width — the
                      div layout could only reach the panel edge. */}
                  <tr>
                    <td
                      colSpan={COLUMN_HEADINGS.length}
                      style={{
                        ...COLUMN_DESCRIPTION_CELL_STYLE,
                        borderBottom:
                          index === columns.length - 1 ? 'none' : '1px solid var(--c-hair)',
                      }}
                    >
                      <div style={COLUMN_DESCRIPTION_INNER_STYLE}>
                        <AutoGrowTextarea
                          value={column.description ?? ''}
                          ariaLabel={`Column ${index + 1} description`}
                          placeholder="description"
                          onChange={(next) => patchAt(index, { description: next || undefined })}
                          style={CELL_PROSE_STYLE}
                        />
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => onChange([...columns, { name: '', type: 'text' }])}
        style={ADD_BUTTON_STYLE}
      >
        + Add column
      </button>
    </div>
  );
};

/** Indexes editor — the ordered `indexes[]`; `columns` is a comma-separated list. */
const IndexesEditor: FC<{ indexes: Index[]; onChange: (next: Index[]) => void }> = ({
  indexes,
  onChange,
}) => {
  const patchAt = (index: number, partial: Partial<Index>) =>
    onChange(indexes.map((ix, i) => (i === index ? { ...ix, ...partial } : ix)));

  // Content-sized like the columns editor — name · columns · flags · remove.
  const widths = [
    contentWidth('name', [...indexes.map((ix) => ix.name ?? ''), 'index_name']),
    contentWidth('columns', [...indexes.map((ix) => ix.columns.join(', ')), 'col_a, col_b']),
    UNIQ_FLAG_WIDTH,
    REMOVE_WIDTH,
  ];

  return (
    <div>
      <div style={EDITOR_TABLE_STYLE}>
        <table style={{ ...EDITOR_GRID_TABLE_STYLE, minWidth: sumWidths(widths) }}>
          <colgroup>
            {widths.map((width, i) => (
              <col key={i} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" style={EDITOR_HEAD_CELL_STYLE}>
                name
              </th>
              <th scope="col" style={EDITOR_HEAD_CELL_STYLE}>
                columns
              </th>
              <th scope="col" style={EDITOR_HEAD_CELL_STYLE}>
                flags
              </th>
              <th scope="col" style={EDITOR_HEAD_CELL_STYLE} />
            </tr>
          </thead>
          <tbody>
            {indexes.length === 0 ? (
              <tr>
                <td colSpan={widths.length} style={EMPTY_HINT_STYLE}>
                  No indexes yet.
                </td>
              </tr>
            ) : (
              indexes.map((ix, index) => (
                <tr
                  key={index}
                  style={{
                    borderBottom:
                      index === indexes.length - 1 ? 'none' : '1px solid var(--c-hair)',
                  }}
                >
                  <td style={EDITOR_CELL_STYLE}>
                    <input
                      value={ix.name ?? ''}
                      aria-label={`Index ${index + 1} name`}
                      placeholder="index_name"
                      onChange={(e) => patchAt(index, { name: e.target.value })}
                      style={CELL_INPUT_STYLE}
                    />
                  </td>
                  {/* Same comma-list cell as a column's `enumValues` — and the
                      same bug before it: derived straight from
                      `columns.join(', ')`, a second index column could never be
                      typed. */}
                  <td style={EDITOR_CELL_STYLE}>
                    <CommaListInput
                      values={ix.columns}
                      ariaLabel={`Index ${index + 1} columns`}
                      placeholder="col_a, col_b"
                      onChange={(columns) => patchAt(index, { columns })}
                      style={CELL_INPUT_STYLE}
                    />
                  </td>
                  <td style={EDITOR_CELL_STYLE}>
                    <Flag
                      label="uniq"
                      checked={ix.unique}
                      onChange={(next) => patchAt(index, { unique: next || undefined })}
                    />
                  </td>
                  <td style={EDITOR_CELL_STYLE}>
                    <button
                      type="button"
                      title={`Remove index ${index + 1}`}
                      onClick={() => onChange(indexes.filter((_, i) => i !== index))}
                      style={REMOVE_BUTTON_STYLE}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => onChange([...indexes, { name: '', columns: [] }])}
        style={ADD_BUTTON_STYLE}
      >
        + Add index
      </button>
    </div>
  );
};

const DatabaseTableDetailForm: FC<{
  entity: DatabaseTableResponse;
  onDeleted?: () => void;
  onRenamed?: (newSlug: string) => void;
  onBackToList?: () => void;
  onSwitchView?: SwitchView;
}> = ({ entity, onDeleted, onRenamed, onBackToList, onSwitchView }) => {
  // The write side is the PLUGIN's — the host supplies no save path.
  const update = useUpdateDatabaseTable();
  const del = useDeleteDatabaseTable();

  const seed = (): Draft => ({
    title: entity.title,
    description: entity.description ?? '',
    columns: entity.columns ?? [],
    indexes: entity.indexes ?? [],
  });

  // Draft vs baseline — `dirty` drives only the "edited"/"saving…" indicator
  // (autosave is unconditional on a debounce tick, not gated behind a Save click).
  const [draft, setDraft] = useState<Draft>(seed);
  const [baseline, setBaseline] = useState<Draft>(seed);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const debounceRef = useRef<number | null>(null);
  // The slug to PATCH against — tracks a rename mid-edit, since `entity.slug` is a
  // stale prop until the host remounts the panel with the new `key`.
  const currentSlugRef = useRef(entity.slug);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  // Auto-grow the title textarea as its content wraps to more lines.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.title]);

  /**
   * The last saved state, as a REF.
   *
   * `scheduleSave` runs from a `setTimeout` closure created several renders
   * earlier, so reading the `baseline` STATE there sees whatever it held when
   * the timer was armed. The body below is computed by diffing against it, and
   * a stale baseline produces a wrong diff.
   */
  const baselineRef = useRef<Draft>(baseline);
  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  /** A draft that arrived while a PATCH was in flight, waiting for its turn. */
  const pendingRef = useRef<Draft | null>(null);

  const scheduleSave = (next: Draft) => {
    // A blank title would `slugify` to an empty slug.
    if (!next.title.trim()) return;

    /**
     * QUEUE, do not drop.
     *
     * This used to `return` when a mutation was in flight, and nothing
     * rescheduled — so with no Save button the edit was simply never sent. The
     * sequence is ordinary: type, pause past the debounce so a PATCH fires,
     * type once more, stop. `onSettled` below flushes whatever landed here.
     */
    if (update.isPending || del.isPending) {
      pendingRef.current = next;
      return;
    }

    /**
     * A PATCH carries only what CHANGED, and that is a correctness requirement
     * rather than a bandwidth one.
     *
     * Sending the name field unconditionally broke two things. It made every
     * save a potential rename — the old code asked for `newSlug` whenever the
     * slugified name differed from the current slug, which is true of any entity
     * whose slug legitimately diverges from its name (an explicit slug at
     * create, a collision suffix inherited from the retired plugin, a name
     * edited in an earlier session). Editing a DESCRIPTION then moved the
     * entity's file and rewrote every page reference to it.
     *
     * And it made inherited tables uneditable. The retired plugin validated the
     * name as a bare string, so a corpus can hold `order`, `group` or
     * `user profile`; indexing from disk still bypasses validation, but the
     * generated update schema now enforces `kind: 'sql-identifier'`. Resending
     * an untouched illegal name turned every keystroke in the description into
     * a 400 with no way out of the panel.
     *
     * 0.2.27 — the rule weighs MORE since the name fields merged, not less: the
     * field that must not be resent unconditionally is now the same field the
     * author edits as the entity's label, so the temptation to just send it is
     * exactly where the damage is.
     */
    const base = baselineRef.current;
    const body: DatabaseTableUpdateInput = {};
    if (next.title !== base.title) body.title = next.title;
    if (next.description !== base.description) body.description = next.description;
    if (JSON.stringify(next.columns) !== JSON.stringify(base.columns)) body.columns = next.columns;
    if (JSON.stringify(next.indexes) !== JSON.stringify(base.indexes)) body.indexes = next.indexes;

    // Nothing actually changed — a timer fired on a draft that matches the
    // baseline (an edit typed and then undone).
    if (Object.keys(body).length === 0) return;

    /**
     * A rename is requested ONLY when the user edited the title AND the slug it
     * derives to actually differs. Both halves matter: the first keeps an
     * unrelated edit from renaming, the second keeps a cosmetic title edit
     * (`order_items` → `Order_Items`) from a no-op rename.
     */
    const nextSlug = slugify(next.title);
    if (body.title !== undefined && nextSlug !== currentSlugRef.current) body.newSlug = nextSlug;

    update.mutate(
      { slug: currentSlugRef.current, body },
      {
        onSuccess: (saved) => {
          currentSlugRef.current = saved.slug;
          setBaseline({
            title: saved.title,
            description: saved.description ?? '',
            columns: saved.columns ?? [],
            indexes: saved.indexes ?? [],
          });
          // Notify the host ONLY on a real slug change.
          if (saved.slug !== entity.slug) onRenamed?.(saved.slug);
        },
        onSettled: () => {
          // Flush whatever arrived mid-flight. On failure too: the draft is
          // still what the user typed, and a retry is better than silence.
          const queued = pendingRef.current;
          if (!queued) return;
          pendingRef.current = null;
          scheduleSave(queued);
        },
      },
    );
  };

  const patch = (partial: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...partial };
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => scheduleSave(next), AUTOSAVE_DELAY_MS);
      return next;
    });
  };

  const handleDelete = () => {
    if (del.isPending) return;
    del.mutate(
      { slug: currentSlugRef.current },
      {
        onSuccess: () => {
          setDeleteConfirmOpen(false);
          onDeleted?.();
        },
      },
    );
  };

  return (
    <DatabaseTableDetailShell
      slug={entity.slug}
      activeView="details"
      onBackToList={onBackToList}
      onSwitchView={onSwitchView}
    >
      <div style={HEADER_WRAP_STYLE}>
        <textarea
          ref={titleRef}
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Table name"
          aria-label="Table name"
          rows={1}
          style={TITLE_TEXTAREA_STYLE}
        />
        <div style={META_ROW_STYLE}>
          <code>{entity.slug}</code>
          <span>updated {formatTimestamp(entity.updatedAt ?? '')}</span>
          {update.isPending ? <span>saving…</span> : dirty ? <span>edited</span> : null}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={del.isPending}
            style={DELETE_BUTTON_STYLE}
            title="Delete"
          >
            Delete
          </button>
        </div>
      </div>
      <div style={CONTENT_WRAP_STYLE}>
        <div style={{ marginTop: 12 }}>
          <TagsField slug={entity.slug} />
        </div>
        <div style={{ marginTop: 32 }}>
          <h3 style={SECTION_HEADING_STYLE}>Description</h3>
          {/* The same control every host built-in uses for `description`
              (endpoint/dto/ac/ui-view/design-system) — markdown in, markdown
              out, and the `prose-spec` type scale (`--text-body`, 15.5px) for
              free, which the bare textarea it replaced could never match. */}
          <DocEditor
            value={draft.description}
            onChange={(md) => patch({ description: md })}
            placeholder="What is this table for?"
          />
        </div>
        <div style={{ marginTop: 32 }}>
          <h3 style={SECTION_HEADING_STYLE}>Columns</h3>
          <ColumnsEditor columns={draft.columns} onChange={(columns) => patch({ columns })} />
        </div>
        <div style={{ marginTop: 32 }}>
          <h3 style={SECTION_HEADING_STYLE}>Indexes</h3>
          <IndexesEditor indexes={draft.indexes} onChange={(indexes) => patch({ indexes })} />
        </div>
        {update.error ? (
          <p role="alert" style={ERROR_STYLE}>
            {update.error.message}
          </p>
        ) : null}
        {del.error ? (
          <p role="alert" style={ERROR_STYLE}>
            {del.error.message}
          </p>
        ) : null}
        <div style={{ marginTop: 32 }}>
          {/*
            Deliberately "Found references", NOT the host DTO panel's "Find references"
            (`claude4spec/src/client/entities/dto/detail-panel.tsx:337`): this section shows
            back-links the host already computed, not a search action. The absence of a refresh
            button and of any `['references', …]` query invalidation is likewise deliberate —
            do not "restore parity" here.
          */}
          <LabelledRow label="Found references">
            <ReferencesSection slug={entity.slug} />
          </LabelledRow>
        </div>
      </div>
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete entity?"
        footer={
          <>
            <ActionButton
              label="Cancel"
              variant="secondary"
              onClick={() => setDeleteConfirmOpen(false)}
            />
            <ActionButton
              label={del.isPending ? 'Deleting…' : 'Delete'}
              variant="primary"
              onClick={handleDelete}
              disabled={del.isPending}
            />
          </>
        }
      >
        <p style={{ margin: 0 }}>
          Delete <strong>{draft.title || entity.slug}</strong>? This can’t be undone.
        </p>
      </Dialog>
    </DatabaseTableDetailShell>
  );
};
