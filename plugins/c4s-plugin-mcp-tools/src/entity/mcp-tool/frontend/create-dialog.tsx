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
 * THE FIELDS ARE THE CREATE CONTRACT AND NOTHING MORE: `name`, `server`,
 * `description` are exactly what the generated schema requires. `params[]` is
 * shaped afterwards in the detail panel — a parameter list is iterative work that
 * does not belong in a modal, and the spec does not require it here. `slug` is
 * not an input: it is derived once, server-side, from `server` and `name`.
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
  const [description, setDescription] = useState('');
  const create = useCreateMcpTool();

  // Stable identity: the kit `Dialog`'s focus effect keys on `onClose`, so an
  // unstable handler would re-run it on every keystroke and steal focus.
  const handleClose = useCallback(() => {
    create.reset();
    setName('');
    setServer(initialServer ?? '');
    setDescription('');
    onClose();
  }, [onClose, create.reset, initialServer]);

  const ready = name.trim() && server.trim() && description.trim();

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
        description: description.trim(),
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
        {/*
          Required at create, and rightly so: a tool whose `description` is filled
          in later is a tool that reached the model with nothing to go on.
        */}
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the tool does and when to use it."
            required
            rows={3}
            style={{ ...INPUT_STYLE, resize: 'vertical' }}
          />
        </FormField>
      </FormShell>
    </Dialog>
  );
};
