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
import { useState } from 'react';
import {
  DATABASE_TABLE_LABEL_PLURAL,
  DATABASE_TABLE_POPOVER_KIND,
  DATABASE_TABLE_TYPE,
  slugify,
} from '../../../identity.js';
import { useCreateDatabaseTable, useDatabaseTableList } from './hooks.js';

/** Window event the host's editor framework dispatches for a declarative plugin command. */
export const PLUGIN_COMMAND_EVENT = 'c4s:plugin-command';

/** This plugin's popover kind — the value carried by the slash-command registration. */
export { DATABASE_TABLE_POPOVER_KIND };

/**
 * The Tiptap node the slash command inserts: the generic inline entity embed,
 * carrying nothing but `{ type, slug }` — which is exactly why the render slot
 * has to re-resolve the entity from the index.
 */
export const DATABASE_TABLE_EMBED_NODE = 'inline_mention';

/**
 * Structural view of the Tiptap `Editor` the host hands over in the event detail.
 * `@tiptap/core` is an optional peer, so the boundary is kept loose here rather
 * than importing the full `Editor` type.
 */
export interface EmbedEditor {
  chain: () => {
    focus: () => {
      insertContent: (content: unknown) => { run: () => void };
    };
  };
}

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

const POPOVER_STYLE: CSSProperties = {
  minWidth: 280,
  maxWidth: 360,
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--c-hair)',
  background: 'var(--c-panel)',
  color: 'var(--c-ink)',
  fontSize: 13,
};

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
    <div data-plugin-popover={DATABASE_TABLE_POPOVER_KIND} style={POPOVER_STYLE} role="dialog">
      <input
        autoFocus
        value={query}
        placeholder={`Embed one of ${DATABASE_TABLE_LABEL_PLURAL}…`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
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

/** Payload the host puts on the `c4s:plugin-command` event. */
export interface PluginCommandDetail {
  popoverKind?: string;
  commandId?: string;
  editor?: EmbedEditor;
}

/**
 * Listen for THIS plugin's slash command. Commands of any other kind are ignored
 * — the event is a single broadcast channel shared by every installed plugin.
 * Returns an unsubscribe function.
 */
export function subscribeToSlashCreate(open: (editor: EmbedEditor) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<PluginCommandDetail>).detail;
    if (!detail || detail.popoverKind !== DATABASE_TABLE_POPOVER_KIND || !detail.editor) return;
    open(detail.editor);
  };
  window.addEventListener(PLUGIN_COMMAND_EVENT, handler);
  return () => window.removeEventListener(PLUGIN_COMMAND_EVENT, handler);
}

/**
 * Entry-point side effect: subscribe, and on the first invocation mount the
 * popover into a plugin-owned container on `document.body`. React DOM and the
 * host's shared `queryClient` are pulled in LAZILY (both are host-provided peers
 * resolved through the import-map shim) so merely importing the frontend entry
 * costs nothing and needs no host present.
 */
export function mountSlashCreatePopover(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

  let host: HTMLElement | null = null;
  let root: { render: (node: unknown) => void; unmount: () => void } | null = null;

  const close = () => {
    root?.render(null);
  };

  const unsubscribe = subscribeToSlashCreate(async (editor) => {
    const [{ createRoot }, { queryClient }, { QueryClientProvider }, { createElement }] =
      await Promise.all([
        import('react-dom/client'),
        import('@c4s/plugin-runtime') as Promise<{ queryClient: unknown }>,
        import('@tanstack/react-query'),
        import('react'),
      ]);
    if (!host) {
      host = document.createElement('div');
      host.dataset.plugin = DATABASE_TABLE_POPOVER_KIND;
      document.body.appendChild(host);
    }
    root ??= createRoot(host) as unknown as typeof root;
    root!.render(
      createElement(
        QueryClientProvider,
        { client: queryClient as never },
        createElement(DatabaseTableSlashCreatePopover, { editor, onClose: close }),
      ),
    );
  });

  return () => {
    unsubscribe();
    root?.unmount();
    host?.remove();
  };
}

/**
 * Named for the entry that calls it. One popover kind, defined in `identity.ts`
 * and re-exported above rather than recomputed here — the manifest command and
 * this listener have to agree on the string or the popover never opens.
 */
export { mountSlashCreatePopover as mountDatabaseTableSlashCreate };
