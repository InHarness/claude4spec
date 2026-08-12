/**
 * `/design-system` — the create-and-embed popover.
 *
 * See the sibling in `entity/ui-view/frontend/slash-create.tsx` for what this
 * replaces: a host component (`NewDesignSystemPopover`) mounted in `App.tsx` and
 * woken by a `c4s:new-design-system` event from `slashInvoke`'s
 * `case 'design-system'` arm. The form and the success path are unchanged.
 */

import { createElement, useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  SlashPopoverShell,
  insertEmbed,
  mountSlashCreatePopover,
  useSlashSubmit,
  type CaretCoords,
  type EmbedEditor,
} from '../../../frontend-kit/slash-create.js';
import { InlineError, PopoverFooter, TextInput } from '../../../frontend-kit/popover-form.js';
import { toast } from '../../../frontend-kit/host-events.js';
import {
  DESIGN_SYSTEM_LABEL,
  DESIGN_SYSTEM_POPOVER_KIND,
  DESIGN_SYSTEM_TYPE,
} from '../../../identity.js';
import { keys as designSystemKeys, useCreateDesignSystem } from './hooks.js';

function DesignSystemSlashCreateForm({
  editor,
  coords,
  onClose,
}: {
  editor: EmbedEditor;
  coords: CaretCoords | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const create = useCreateDesignSystem();
  const qc = useQueryClient();

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const { error, setError, busy, submit } = useSlashSubmit(async () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name is required');
    const ds = await create.mutateAsync({
      name: trimmed,
      description: description.trim() || undefined,
    });
    void qc.invalidateQueries({ queryKey: designSystemKeys.all });
    insertEmbed(editor, DESIGN_SYSTEM_TYPE, ds.slug);
    toast.success(`${DESIGN_SYSTEM_LABEL} ${ds.slug} created`);
    onClose();
    return ds;
  });

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <SlashPopoverShell
      width={320}
      title="New design system"
      icon={<Palette size={12} style={{ color: 'var(--c-accent)' }} />}
      coords={coords}
      onCancel={onClose}
    >
      <TextInput
        ref={nameRef}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onEnter}
        placeholder="Brand 2026"
        className="mb-2"
      />
      <TextInput
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={onEnter}
        placeholder="What this design system covers (optional)"
        style={{ fontSize: 12.5 }}
      />
      <InlineError message={error} />
      <PopoverFooter
        onCancel={onClose}
        onSubmit={() => void submit()}
        submitLabel="Create"
        busy={busy}
      />
    </SlashPopoverShell>
  );
}

export function mountDesignSystemSlashCreate(): () => void {
  return mountSlashCreatePopover(DESIGN_SYSTEM_POPOVER_KIND, (props) =>
    createElement(DesignSystemSlashCreateForm, props),
  );
}
