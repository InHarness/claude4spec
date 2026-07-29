/**
 * The DTO list's CREATE modal — the kit `Dialog`, mirroring the endpoint side.
 *
 * New in 0.2.2. The host list used to open its own `create-dto` popover through
 * the host-owned popover registry, which a package outside the host cannot
 * reach. The popover form survives as the SLASH-create surface
 * (`slash-create.tsx`); this is the list-screen surface, and the two are
 * deliberately different — a modal for a deliberate "new DTO", a light anchored
 * popover for an inline `/dto` while writing.
 */

import { useState } from 'react';
import { ActionButton, Dialog, FormField, FormShell } from '@c4s/plugin-runtime/ui';
import { useCreateDto } from './hooks.js';

interface Props {
  onClose: () => void;
  onCreated: (dto: { slug: string; name: string }) => void;
}

export function DtoCreateDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateDto();

  async function submit() {
    if (!name.trim()) {
      setFormError('Name is required');
      return;
    }
    const tags = tagsText
      .split(/[, ]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const dto = await create.mutateAsync({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(tags.length ? { tags } : {}),
      });
      onCreated(dto);
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="New DTO"
      footer={
        <>
          <ActionButton label="Cancel" variant="ghost" onClick={onClose} />
          <ActionButton
            label={create.isPending ? 'Creating…' : 'Create'}
            variant="primary"
            disabled={create.isPending}
            onClick={() => void submit()}
          />
        </>
      }
    >
      <FormShell error={formError} onSubmit={() => void submit()}>
        <FormField label="Name (PascalCase)">
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (formError) setFormError(null);
            }}
            placeholder="UserResponse"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
        </FormField>
        <FormField label="Description (optional)">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Returned by GET /users"
          />
        </FormField>
        <FormField label="Tags (optional)">
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="auth, public"
          />
        </FormField>
      </FormShell>
    </Dialog>
  );
}
