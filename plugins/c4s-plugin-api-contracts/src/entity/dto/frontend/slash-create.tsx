/**
 * `/dto` — the plugin-rendered slash-create popover.
 *
 * Same form as before, different plumbing: it now creates the DTO itself and
 * inserts the embed, instead of returning a payload for the host's
 * `runCreateDto` to act on. See `frontend-kit/slash-create.tsx` for the protocol.
 */

import { useEffect, useRef, useState } from 'react';
import { Braces } from 'lucide-react';
import { FieldLabel, InlineError, PopoverFooter, TextInput } from '../../../frontend-kit/popover-form.js';
import {
  SlashPopoverShell,
  insertEmbed,
  mountSlashCreatePopover,
  useSlashSubmit,
  type EmbedEditor,
} from '../../../frontend-kit/slash-create.js';
import { toast } from '../../../frontend-kit/host-events.js';
import { DTO_TYPE } from '../../../identity.js';
import { dtosApi } from './api.js';

export const DTO_POPOVER_KIND = `${DTO_TYPE}-create`;

export function DtoSlashCreatePopover({
  editor,
  onClose,
}: {
  editor: EmbedEditor;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const { error, busy, submit } = useSlashSubmit(async () => {
    const dto = await dtosApi.create({
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
    });
    insertEmbed(editor, DTO_TYPE, dto.slug);
    toast.success(`DTO ${dto.name} created`);
    onClose();
    return dto;
  });

  const onSubmit = () => {
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    void submit();
  };

  return (
    <SlashPopoverShell
      width={340}
      title="New DTO"
      icon={<Braces size={12} style={{ color: 'var(--c-accent)' }} />}
      onCancel={onClose}
    >
      <FieldLabel>Name (PascalCase)</FieldLabel>
      <TextInput
        ref={nameRef}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="UserResponse"
        style={{ fontFamily: 'ui-monospace, monospace' }}
      />
      <div style={{ marginTop: 8 }}>
        <FieldLabel>Description (optional)</FieldLabel>
        <TextInput
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Returned by GET /users"
        />
      </div>
      <InlineError message={nameError ?? error} />
      <PopoverFooter onCancel={onClose} onSubmit={onSubmit} submitLabel="Create" busy={busy} />
    </SlashPopoverShell>
  );
}

export const mountDtoSlashCreate = () => mountSlashCreatePopover(DTO_POPOVER_KIND, DtoSlashCreatePopover);
