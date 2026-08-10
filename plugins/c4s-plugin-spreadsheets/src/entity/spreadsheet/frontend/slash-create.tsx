/**
 * `/spreadsheet` — the plugin-rendered slash-create popover.
 *
 * NEW IN THIS PORT, not moved. The v1 plugin declared the command and its
 * `pluginPopoverKind` and stopped there, on the assumption that the host owned a
 * popover for it the way it owns `/diagram`. It does not: the host dispatches
 * `c4s:plugin-command` with the kind and nothing else, and a kind nobody listens
 * for is a slash command that deletes the typed text and opens nothing. So the
 * form is written here.
 */

import { useEffect, useRef, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { FieldLabel, InlineError, PopoverFooter, TextInput } from '../../../frontend-kit/popover-form.js';
import {
  SlashPopoverShell,
  type CaretCoords,
  type EmbedEditor,
  mountSlashCreatePopover,
  useSlashSubmit,
} from '../../../frontend-kit/slash-create.js';
import { toast } from '../../../frontend-kit/host-events.js';
import { apiFetch } from '../../../frontend-kit/api-core.js';
import { SPREADSHEET_POPOVER_KIND, SPREADSHEET_TYPE } from '../../../identity.js';

export { SPREADSHEET_POPOVER_KIND };

/**
 * 0.2.15 — insert the GENERIC block embed.
 *
 * This used to insert the type's own `<spreadsheet/>` node, on the grounds that
 * a spreadsheet's embed is a grid rather than a card. That distinction is gone:
 * the grid IS the card now (`renderCard`), reached through
 * `<single_element type="spreadsheet" slug="…"/>` like every other entity. The
 * `caption` attribute is omitted rather than set to null, so a freshly inserted
 * tag never carries an empty one.
 */
function insertSpreadsheet(editor: EmbedEditor, slug: string): void {
  editor
    .chain()
    .focus()
    .insertContent({ type: 'single_element', attrs: { type: SPREADSHEET_TYPE, slug } })
    .run();
}

const DEFAULT_ROWS = 5;
const DEFAULT_COLS = 3;

export function SpreadsheetSlashCreatePopover({
  editor,
  coords,
  onClose,
}: {
  editor: EmbedEditor;
  coords: CaretCoords | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState(String(DEFAULT_ROWS));
  const [cols, setCols] = useState(String(DEFAULT_COLS));
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const { error, busy, submit } = useSlashSubmit(async () => {
    /*
     * The dimensions are set at creation because they are the axis EXTENTS, and
     * a write past the extent is refused. A sheet created 0×0 would accept no
     * cells at all until someone resized it — which is a confusing first
     * experience for something that looks like a grid.
     */
    const res = await apiFetch(`/api/${SPREADSHEET_TYPE}s`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        nRows: clamp(rows, DEFAULT_ROWS),
        nCols: clamp(cols, DEFAULT_COLS),
        headerRow: true,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `Could not create the spreadsheet (${res.status})`);
    }
    const body = (await res.json()) as { data?: { slug: string; name?: string } };
    const created = body.data;
    if (!created?.slug) throw new Error('The server created the spreadsheet but returned no slug');

    insertSpreadsheet(editor, created.slug);
    toast.success(`Spreadsheet ${created.name ?? created.slug} created`);
    onClose();
    return created;
  });

  const onSubmit = () => {
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    void submit();
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <SlashPopoverShell
      width={340}
      title="New spreadsheet"
      coords={coords}
      icon={<Grid3x3 size={12} style={{ color: 'var(--c-accent)' }} />}
      onCancel={onClose}
    >
      <FieldLabel>Name</FieldLabel>
      <TextInput
        ref={nameRef}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(null);
        }}
        onKeyDown={onEnter}
        placeholder="Q1 revenue"
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <FieldLabel>Rows</FieldLabel>
          <TextInput value={rows} onChange={(e) => setRows(e.target.value)} onKeyDown={onEnter} inputMode="numeric" />
        </div>
        <div style={{ flex: 1 }}>
          <FieldLabel>Columns</FieldLabel>
          <TextInput value={cols} onChange={(e) => setCols(e.target.value)} onKeyDown={onEnter} inputMode="numeric" />
        </div>
      </div>
      <InlineError message={nameError ?? error} />
      <PopoverFooter onCancel={onClose} onSubmit={onSubmit} submitLabel="Create" busy={busy} />
    </SlashPopoverShell>
  );
}

/** A blank or nonsense dimension falls back rather than creating an unusable 0-extent sheet. */
function clamp(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 1000);
}

export const mountSpreadsheetSlashCreate = () =>
  mountSlashCreatePopover(SPREADSHEET_POPOVER_KIND, SpreadsheetSlashCreatePopover);
