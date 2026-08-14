/**
 * `/uiview` — the create-and-embed popover.
 *
 * Before 0.2.18 this was `NewUiViewPopover`, a host component mounted
 * unconditionally in `App.tsx` and woken by a `c4s:new-ui-view` window event
 * that `slashInvoke`'s `case 'ui-view'` arm dispatched. All three of those host
 * pieces are gone: the command is declared on the manifest with a `popoverKind`,
 * the host dispatches the generic `c4s:plugin-command`, and the popover mounts
 * itself from this package's frontend entry.
 *
 * The FORM is unchanged — name, url, description, Enter-to-submit — and so is
 * what happens on success: invalidate the list query, insert a `single_element`
 * embed at the caret, toast.
 */

import { createElement, useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
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
import { UI_VIEW_LABEL, UI_VIEW_POPOVER_KIND, UI_VIEW_TYPE } from '../../../identity.js';
import { keys as uiViewKeys, useCreateUiView } from './hooks.js';

function UiViewSlashCreateForm({
  editor,
  coords,
  onClose,
}: {
  editor: EmbedEditor;
  coords: CaretCoords | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const create = useCreateUiView();
  const qc = useQueryClient();

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const { error, setError, busy, submit } = useSlashSubmit(async () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name is required');
    const view = await create.mutateAsync({
      title: trimmed,
      url: url.trim() || null,
      description: description.trim() || undefined,
    });
    void qc.invalidateQueries({ queryKey: uiViewKeys.all });
    insertEmbed(editor, UI_VIEW_TYPE, view.slug);
    toast.success(`${UI_VIEW_LABEL} ${view.title} created`);
    onClose();
    return view;
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
      title="New UI view"
      icon={<Monitor size={12} style={{ color: 'var(--c-accent)' }} />}
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
        placeholder="User Profile Screen"
        className="mb-2"
      />
      <TextInput
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={onEnter}
        placeholder="/users/:id (empty = modal/drawer)"
        className="font-mono mb-2"
        style={{ fontSize: 12.5 }}
      />
      <TextInput
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={onEnter}
        placeholder="What this screen does (optional)"
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

export function mountUiViewSlashCreate(): () => void {
  return mountSlashCreatePopover(UI_VIEW_POPOVER_KIND, (props) =>
    createElement(UiViewSlashCreateForm, props),
  );
}
