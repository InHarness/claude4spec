/**
 * The create modal, opened by the CREATE button in the list header's `actions`
 * slot. Not a host slot and not a route — controlled by the parent through
 * `open` / `onClose`.
 *
 * WHY THIS EXISTS AT ALL, given the package contributes no `editorExtensions`:
 * those are two different doors. The brief closes the EDITOR door — there is no
 * `/mcp-tool` slash command, because a tool is not authored "in flight" in prose
 * the way a diagram is. It is written while describing its server, which is this
 * screen. A visible type with no way to create one from its own list would be a
 * read-only list of records nothing can produce.
 *
 * Composed ENTIRELY from kit shells: the `Dialog` overlay wraps a `FormShell`
 * composing one `FormField` per input. The mutation is the PLUGIN's — the kit
 * ships none. `busy` blocks resubmit, `error` renders the failure and the modal
 * STAYS open; on success it closes and the list refetches.
 *
 * THE FIELDS ARE `name` AND `server`, AND NOTHING MORE — the two halves of
 * `mcp__{server}__{name}`, which is also the two halves of the slug. They are
 * the only values that must exist before the record does.
 *
 * `description` is deliberately NOT here, even though the schema marks it
 * required. It is the longest prose on the type and it is written in the detail
 * panel, in a full-width markdown editor, with the parameters and the return
 * shape in view; a three-line box in a modal invites a placeholder sentence
 * written to get past the dialog, which then reaches the model as if it were a
 * description. The record is created with an empty one and filled in next door.
 * `params[]` is left to the same screen for the same reason. `slug` is not an
 * input at all: it is derived once, server-side, from `server` and `name`.
 *
 */

import type { CSSProperties, FC, FormEvent } from 'react';
import { useCallback, useState } from 'react';
import { ActionButton, Dialog, FormField, FormShell } from '@c4s/plugin-runtime/ui';
import { MCP_TOOL_LABEL } from '../../../identity.js';
import { useCreateMcpTool } from './hooks.js';

export interface McpToolCreateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Opened from a server's group heading — pre-fills and locks nothing, just seeds. */
  initialServer?: string;
}

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--c-hair)',
  background: 'var(--c-panel)',
  color: 'var(--c-ink)',
};

export const McpToolCreateDialog: FC<McpToolCreateDialogProps> = ({
  open,
  onClose,
  initialServer,
}) => {
  const [name, setName] = useState('');
  const [server, setServer] = useState(initialServer ?? '');
  const create = useCreateMcpTool();

  // Stable identity: the kit `Dialog`'s focus effect keys on `onClose`, so an
  // unstable handler would re-run it on every keystroke and steal focus.
  const handleClose = useCallback(() => {
    create.reset();
    setName('');
    setServer(initialServer ?? '');
    onClose();
  }, [onClose, create.reset, initialServer]);

  const ready = name.trim() && server.trim();

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready || create.isPending) return;
    // No tags. Tagging an mcp-tool is an ordinary, deliberate authoring act —
    // the same as for every other entity type — not something the create path
    // derives from a field.
    create.mutate(
      {
        name: name.trim(),
        server: server.trim(),
        // `description` is required by the generated schema but has no minimum
        // length, so the record starts with an empty one and is described in the
        // detail panel. Omitting the key entirely would be rejected.
        description: '',
      },
      { onSuccess: handleClose },
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} title={`New ${MCP_TOOL_LABEL}`} size="md">
      <FormShell
        onSubmit={handleSubmit}
        busy={create.isPending}
        error={create.error ? create.error.message : undefined}
        actions={
          <>
            <ActionButton
              label="Cancel"
              variant="ghost"
              onClick={handleClose}
              disabled={create.isPending}
            />
            <ActionButton
              type="submit"
              variant="primary"
              label={create.isPending ? 'Creating…' : 'Create'}
              disabled={!ready || create.isPending}
            />
          </>
        }
      >
        <FormField label="Server">
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="claude4spec"
            required
            autoFocus={!initialServer}
            style={{ ...INPUT_STYLE, fontFamily: 'var(--font-mono, monospace)' }}
          />
        </FormField>
        <FormField label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="read_page"
            required
            autoFocus={Boolean(initialServer)}
            style={{ ...INPUT_STYLE, fontFamily: 'var(--font-mono, monospace)' }}
          />
        </FormField>
      </FormShell>
    </Dialog>
  );
};
