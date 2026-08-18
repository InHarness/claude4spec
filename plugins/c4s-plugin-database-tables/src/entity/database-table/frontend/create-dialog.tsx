/**
 * M05 / L8 — the create modal (`ui-view database-table-create-dialog`). Opened by
 * the CREATE button in the list header's `actions` slot; NOT a host slot and NOT a
 * route (no `url`). Controlled by the parent through `open` / `onClose`.
 *
 * Composed ENTIRELY from Host UI Kit shells (`@c4s/plugin-runtime/ui`): the
 * `Dialog` overlay (controlled, presentational — own NO modal markup) wraps a
 * `FormShell` (a `<form>` with a `<fieldset disabled={busy}>`, a form-level error
 * line, and an actions row) composing one `FormField` per input. The mutation is
 * the PLUGIN's (`useCreateDatabaseTable`) — the kit ships no mutation; it is wired
 * to `FormShell.onSubmit`. `busy` blocks resubmit, `error` renders the failure and
 * the modal STAYS open; on success `handleClose` closes it and the list refetches
 * (the hook invalidates the `['database-table']` query prefix).
 *
 * Both footer buttons are `ActionButton`s — Create carries `type="submit"` so the
 * form's `onSubmit` is its only handler (no `onClick`, which would double-fire).
 * Own NO button styling: `variant="primary"` is what puts a readable label on the
 * accent fill, and `variant="ghost"` matches it for Cancel.
 *
 * `Dialog` / `FormShell` are `experimental` kit components (outside the
 * `hostApiVersion` guarantee — their props may change without a major).
 *
 * Distinct from the slash-create POPOVER (`slash-create.tsx`), which the plugin
 * renders itself: this is the kit `Dialog` shell reached from the list screen.
 *
 * The only field is `name` — the SQL identifier. `slug` is NOT an input (it is
 * `slugify(name)`, derived server-side), and `columns[]`/`indexes[]` are shaped
 * afterwards in the detail panel, the spec's single real editing surface.
 */

import type { CSSProperties, FC, FormEvent } from 'react';
import { useCallback, useState } from 'react';
import { ActionButton, Dialog, FormField, FormShell } from '@c4s/plugin-runtime/ui';
import { DATABASE_TABLE_LABEL } from '../../../identity.js';
import { useCreateDatabaseTable } from './hooks.js';

export interface DatabaseTableCreateDialogProps {
  /** Controlled visibility — the list screen owns this. */
  open: boolean;
  /** Requested close (scrim / Escape / ✕ / Cancel / post-success). */
  onClose: () => void;
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

export const DatabaseTableCreateDialog: FC<DatabaseTableCreateDialogProps> = ({ open, onClose }) => {
  const [name, setName] = useState('');
  const create = useCreateDatabaseTable();

  // Reset local form + mutation state on close so the next open starts clean.
  // Stable identity (the host `Dialog`'s focus effect keys on `onClose`): an
  // unstable handler would re-run that effect on every keystroke and steal focus.
  const handleClose = useCallback(() => {
    create.reset();
    setName('');
    onClose();
  }, [onClose, create.reset]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || create.isPending) return;
    // `columns` is REQUIRED by the create contract — an omitted key is a 400
    // (`VALIDATION_ERROR / columns: Required`), not an empty table. The dialog
    // shapes no columns, so it sends the empty list explicitly.
    create.mutate({ title: name.trim(), columns: [] }, { onSuccess: handleClose });
  };

  return (
    <Dialog open={open} onClose={handleClose} title={`New ${DATABASE_TABLE_LABEL}`} size="md">
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
              disabled={!name.trim() || create.isPending}
            />
          </>
        }
      >
        <FormField label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Database table name"
            required
            autoFocus
            style={INPUT_STYLE}
          />
        </FormField>
      </FormShell>
    </Dialog>
  );
};
