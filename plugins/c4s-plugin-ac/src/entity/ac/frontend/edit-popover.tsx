/**
 * `ac-edit` — the edit popover, opened with Alt+click on an `ac` chip or card
 * (the entity-popover convention: Alt+click edits).
 *
 * Fields, all filled with the current values: Title (textarea), Kind and Status
 * (2.1.16 — `EnumBadgePicker`, the same control as on the detail page), Tags
 * (comma separated, with the project's tags as autocomplete). `verifies` is
 * edited on the detail page — too complex for a popover. Remove (red, bottom
 * left) opens `ac-delete`. Save → toast "AC updated".
 */

import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckSquare } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTags } from '@c4s/plugin-runtime';
import { EnumBadgePicker } from '@c4s/plugin-runtime/ui';
import { SlashPopoverShell, useSlashSubmit, type CaretCoords } from '../../../frontend-kit/slash-create.js';
import { FieldLabel, InlineError, PopoverFooter, TextInput } from '../../../frontend-kit/popover-form.js';
import { toast } from '../../../frontend-kit/host-events.js';
import { AC_TITLE_MAX_LENGTH } from '../../../identity.js';
import type { Ac, AcKind, AcStatus } from '../../../types.js';
import { acsApi } from './api.js';
import { keys as acKeys, useUpdateAc } from './hooks.js';
import { AC_KIND_OPTIONS, AC_STATUS_OPTIONS } from './enum-options.js';
import { confirmAndDeleteAc } from './delete-confirm.js';

export const AC_EDIT_POPOVER_KIND = 'ac-edit';

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function AcEditForm({
  entity,
  coords,
  onClose,
}: {
  entity: Ac;
  coords?: CaretCoords | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(entity.title);
  const [kind, setKind] = useState<AcKind>(entity.kind);
  const [status, setStatus] = useState<AcStatus>(entity.status);
  const [tagsRaw, setTagsRaw] = useState(entity.tags.join(', '));
  const { data: knownTags = [] } = useTags();
  const update = useUpdateAc();
  const qc = useQueryClient();
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const { error, setError, busy, submit } = useSlashSubmit(async () => {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Title is required');
    if (trimmed.length > AC_TITLE_MAX_LENGTH) {
      throw new Error(`${trimmed.length} characters — the limit is ${AC_TITLE_MAX_LENGTH}.`);
    }
    return update.mutateAsync({
      slug: entity.slug,
      input: { title: trimmed, kind, status, tags: parseTags(tagsRaw) },
    });
  });

  const save = async () => {
    const updated = await submit();
    if (!updated) return;
    toast.success('AC updated');
    onClose();
  };

  const removeAc = () => {
    onClose();
    void confirmAndDeleteAc(entity.slug, async (slug) => {
      await acsApi.remove(slug);
      void qc.invalidateQueries({ queryKey: acKeys.all });
      qc.removeQueries({ queryKey: acKeys.detail(slug) });
      void qc.invalidateQueries({ queryKey: ['tags'] });
    });
  };

  return (
    <SlashPopoverShell
      width={400}
      title="Edit acceptance criterion"
      icon={<CheckSquare size={12} style={{ color: 'var(--c-accent)' }} />}
      coords={coords ?? null}
      onCancel={onClose}
    >
      <FieldLabel>Title</FieldLabel>
      <textarea
        ref={titleRef}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          // Enter saves; Shift+Enter is a newline.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
        rows={3}
        maxLength={AC_TITLE_MAX_LENGTH}
        aria-label="Title"
        className="w-full rounded-md text-[13px] outline-none px-2 py-1.5"
        style={{
          background: 'var(--c-panel)',
          border: '1px solid var(--c-hair)',
          color: 'var(--c-ink)',
          resize: 'vertical',
        }}
      />

      <div className="mt-2 flex items-center gap-3">
        <FieldLabel>Kind</FieldLabel>
        <EnumBadgePicker
          options={AC_KIND_OPTIONS}
          value={kind}
          onChange={(v) => setKind(v as AcKind)}
        />
        <FieldLabel>Status</FieldLabel>
        <EnumBadgePicker
          options={AC_STATUS_OPTIONS}
          value={status}
          onChange={(v) => setStatus(v as AcStatus)}
        />
      </div>

      <div className="mt-2">
        <FieldLabel>Tags (comma separated)</FieldLabel>
        <TextInput
          list="c4s-ac-edit-tags"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="m07, security"
          aria-label="Tags"
        />
        <datalist id="c4s-ac-edit-tags">
          {knownTags.map((t) => (
            <option key={t.slug} value={t.slug} />
          ))}
        </datalist>
      </div>

      <InlineError message={error} />
      <PopoverFooter
        onCancel={onClose}
        onSubmit={() => void save()}
        submitLabel="Save"
        busy={busy}
        onRemove={removeAc}
      />
    </SlashPopoverShell>
  );
}

/**
 * Mount the popover imperatively inside the host's OWN query client — the
 * trigger is an Alt+click deep inside a Tiptap node view, where there is no
 * place to hang popover state; the shared client is what lets the save reach
 * the chip that opened it.
 */
export function openAcEditPopover(entity: Ac, coords?: CaretCoords | null): void {
  if (typeof document === 'undefined') return;
  const host = document.createElement('div');
  host.dataset.plugin = AC_EDIT_POPOVER_KIND;
  document.body.appendChild(host);
  void (async () => {
    const [runtime, { QueryClientProvider }] = await Promise.all([
      import('@c4s/plugin-runtime') as Promise<{ queryClient: unknown }>,
      import('@tanstack/react-query'),
    ]);
    const root = createRoot(host);
    const close = () => {
      root.unmount();
      host.remove();
    };
    root.render(
      <QueryClientProvider client={runtime.queryClient as never}>
        <AcEditForm entity={entity} coords={coords} onClose={close} />
      </QueryClientProvider>,
    );
  })();
}

/**
 * Alt+click on a chip or card opens `ac-edit`; a plain click is left alone.
 * Answers whether the gesture was consumed.
 */
export function acEditGesture(entity: Ac | null | undefined, e: React.MouseEvent): boolean {
  if (!entity || !e.altKey) return false;
  e.preventDefault();
  e.stopPropagation();
  openAcEditPopover(entity, { x: e.clientX, y: e.clientY + 8 } as CaretCoords);
  return true;
}
