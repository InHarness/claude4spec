/**
 * The `/database-table` slash command's EXECUTION half — the plugin-rendered
 * slash-create popover and the embed insertion it performs
 * (`ac-slash-komenda-database-table-wstawia-os`).
 *
 * How the host wires this (M33, `client/tiptap/slashInvoke.ts`): a declarative
 * plugin command carries a `pluginPopoverKind`; invoking it makes the editor
 * framework dispatch a `c4s:plugin-command` window event carrying
 * `{ popoverKind, commandId, editor }` — and then does nothing more. Execution is
 * the PLUGIN's: it listens for its own kind, renders its own popover (this is the
 * "popover slash-create", explicitly NOT the Host UI Kit `Dialog` the create
 * modal uses), and inserts the embed node into the editor it was handed.
 *
 * After insertion the document holds only `{ type, slug }` — no snapshot of the
 * entity — so the render slot that draws the embed resolves it through the
 * module's `useGetBySlug`, i.e. FRESH data from the index on every render, which
 * is the second half of the AC.
 *
 * SPEC/HOST GAP: neither the event name nor the embed node name is exported to
 * plugins by `@c4s/plugin-runtime`; both are mirrored here from the host source.
 * See the report.
 */

import type { CSSProperties, FC } from 'react';
import { createElement, useState } from 'react';
import {
  SlashPopoverShell,
  mountSlashCreatePopover,
  type EmbedEditor,
} from '../../../frontend-kit/slash-create.js';
import {
  DATABASE_TABLE_LABEL_PLURAL,
  DATABASE_TABLE_POPOVER_KIND,
  DATABASE_TABLE_TYPE,
  slugify,
} from '../../../identity.js';
import { useCreateDatabaseTable, useDatabaseTableList } from './hooks.js';

/**
 * THE MOUNT MACHINERY IS THE KIT'S, not this file's.
 *
 * This file used to re-implement `subscribeToSlashCreate` and
 * `mountSlashCreatePopover` itself, and the copy was missing the one thing that
 * matters: the kit keeps a `window`-level registry of live mounts and tears the
 * previous mount of a kind down before installing a new one. Without it every
 * frontend reload — a dev-watch rebuild, any reinstall — stacked another
 * `c4s:plugin-command` listener, so after two reloads one `/database-table`
 * opened three overlapping popovers and creating from them made `orders`,
 * `orders-2` and `orders-3`. The kit's own comment says it exists to prevent
 * exactly that, and `frontend.tsx` already claimed this file behaved that way.
 *
 * The kit also anchors the popover at the caret; the hand-rolled copy ignored
 * the coords the host sends and rendered it unpositioned.
 */

/** This plugin's popover kind — the value carried by the slash-command registration. */
export { DATABASE_TABLE_POPOVER_KIND };
export type { EmbedEditor };

/**
 * The Tiptap node the slash command inserts: the generic inline entity embed,
 * carrying nothing but `{ type, slug }` — which is exactly why the render slot
 * has to re-resolve the entity from the index.
 */
export const DATABASE_TABLE_EMBED_NODE = 'inline_mention';

/** The embed node the slash command inserts for `slug`. */
export function databaseTableEmbedNode(slug: string): {
  type: string;
  attrs: { type: string; slug: string };
} {
  return { type: DATABASE_TABLE_EMBED_NODE, attrs: { type: DATABASE_TABLE_TYPE, slug } };
}

/** Insert the entity embed for `slug` at the editor's caret. */
export function insertDatabaseTableEmbed(editor: EmbedEditor, slug: string): void {
  editor.chain().focus().insertContent(databaseTableEmbedNode(slug)).run();
}

/** Width the kit's shell is asked for; the chrome around it is the shell's. */
const POPOVER_WIDTH = 320;

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--c-hair)',
  background: 'var(--c-bg)',
  color: 'var(--c-ink)',
};

const OPTION_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '5px 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--c-ink)',
  cursor: 'pointer',
  fontSize: 13,
};

export interface SlashCreatePopoverProps {
  /** The editor the host handed over with the command event. */
  editor: EmbedEditor;
  /** Dismiss (Escape, pick, or a completed create). */
  onClose: () => void;
}

/**
 * Plugin-rendered slash-create popover: filter the existing tables, pick one to
 * embed it, or create a new one (`slug = slugify(name)`) and embed that. Purely
 * presentational over the plugin's own hooks — no Host UI Kit shell, because the
 * kit's `Dialog` is the create MODAL, a different surface.
 */
export const DatabaseTableSlashCreatePopover: FC<SlashCreatePopoverProps> = ({
  editor,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const { data: items = [] } = useDatabaseTableList();
  const create = useCreateDatabaseTable();

  const q = query.trim().toLowerCase();
  const matches = items.filter((it) => !q || it.name.toLowerCase().includes(q) || it.slug.includes(q));
  const exactExists = items.some((it) => it.slug === slugify(query));

  const embed = (slug: string) => {
    insertDatabaseTableEmbed(editor, slug);
    onClose();
  };

  const handleCreate = () => {
    if (!query.trim() || create.isPending) return;
    // Explicit empty `columns` — the create contract requires the key; omitting
    // it is a 400, not an empty table (same as the create dialog).
    create.mutate(
      { name: query.trim(), columns: [] },
      { onSuccess: (entity) => embed(entity.slug) },
    );
  };

  return (
    <div data-plugin-popover={DATABASE_TABLE_POPOVER_KIND}>
      <input
        autoFocus
        value={query}
        placeholder={`Embed one of ${DATABASE_TABLE_LABEL_PLURAL}…`}
        onChange={(e) => setQuery(e.target.value)}
        style={INPUT_STYLE}
      />
      <div role="listbox" style={{ marginTop: 6 }}>
        {matches.map((it) => (
          <button
            key={it.slug}
            type="button"
            role="option"
            data-slug={it.slug}
            onClick={() => embed(it.slug)}
            style={OPTION_STYLE}
          >
            {it.name}
          </button>
        ))}
      </div>
      {query.trim() && !exactExists ? (
        <button type="button" data-action="create" onClick={handleCreate} style={OPTION_STYLE}>
          {create.isPending ? 'Creating…' : `Create “${query.trim()}”`}
        </button>
      ) : null}
      {create.error ? (
        <p role="alert" style={{ color: 'var(--c-red)', fontSize: 12.5, margin: '4px 0 0' }}>
          {create.error.message}
        </p>
      ) : null}
    </div>
  );
};

/**
 * Mount this plugin's popover, through the kit.
 *
 * Idempotent per kind: a second call replaces the first mount instead of adding
 * a listener beside it.
 */
export function mountDatabaseTableSlashCreate(): () => void {
  return mountSlashCreatePopover(DATABASE_TABLE_POPOVER_KIND, ({ editor, coords, onClose }) =>
    createElement(
      SlashPopoverShell,
      {
        width: POPOVER_WIDTH,
        title: `Embed one of ${DATABASE_TABLE_LABEL_PLURAL}`,
        coords,
        onCancel: onClose,
        children: createElement(DatabaseTableSlashCreatePopover, { editor, onClose }),
      },
    ),
  );
}
