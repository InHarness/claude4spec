/**
 * The list screen's "New AC" dialog.
 *
 * Before 0.2.80 the list page called the host's `openPopover('create-ac', …)`,
 * which reached the host's own popover registry — a facade an envelope has no
 * access to, and should not: it is the mechanism by which the HOST renders a
 * popover it knows the shape of. The `Dialog` / `FormShell` catalog components
 * are the published equivalent, and every extracted envelope's list screen
 * already creates through them.
 *
 * The `/ac` slash command keeps a POPOVER (`slash-create.tsx`), which is a
 * different surface for a different gesture: it is anchored at the caret and
 * inserts an embed where the user was typing. Same fields, deliberately — a
 * criterion, a kind and some tags — because they are the same create.
 */

import { useState, type FormEvent } from 'react';
import { Dialog, FormShell, FormField, ActionButton } from '@c4s/plugin-runtime/ui';
import { AC_TITLE_MAX_LENGTH } from '../../../identity.js';
import type { AcKind } from '../../../types.js';
import { useCreateAc } from './hooks.js';

interface Props {
  onClose: () => void;
  onCreated: (slug: string) => void;
  /** Tags to start with, when the caller knows the context. */
  defaultTags?: string[];
}

export function AcCreateDialog({ onClose, onCreated, defaultTags }: Props) {
  /**
   * 0.2.51 — the form collects `title`, which IS the criterion.
   *
   * It used to collect `text` and let the server derive a 200-character `title`
   * from it. There is no second field to derive from any more, and `title` is
   * required with no `computedDefault`, so a submit without it is a 400 rather
   * than a silently-labelled AC. Still a textarea: the criterion is a sentence
   * and may wrap, which is not the same thing as it being multi-paragraph prose.
   */
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AcKind>('requirement');
  const [tagsRaw, setTagsRaw] = useState((defaultTags ?? []).join(', '));
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateAc();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit();
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setFormError('Title is required');
      return;
    }
    if (trimmed.length > AC_TITLE_MAX_LENGTH) {
      setFormError(
        `${trimmed.length} characters — the limit is ${AC_TITLE_MAX_LENGTH}. A criterion this long ` +
          'is usually several criteria; split it.',
      );
      return;
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      const ac = await create.mutateAsync({ title: trimmed, kind, ...(tags.length ? { tags } : {}) });
      onCreated(ac.slug);
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  return (
    <Dialog open onClose={onClose} size="sm" title="New acceptance criterion">
      <FormShell
        onSubmit={handleSubmit}
        busy={create.isPending}
        error={formError}
        actions={
          <>
            <ActionButton
              variant="ghost"
              label="Cancel"
              onClick={onClose}
              disabled={create.isPending}
            />
            <ActionButton
              type="submit"
              variant="primary"
              label={create.isPending ? 'Creating…' : 'Create'}
              disabled={create.isPending}
            />
          </>
        }
      >
        <FormField label="Title (observable behavior)">
          <textarea
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (formError) setFormError(null);
            }}
            onKeyDown={(e) => {
              // A criterion may wrap, so plain Enter inserts a newline; the
              // form's submit button is the Enter target everywhere else.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={3}
            maxLength={AC_TITLE_MAX_LENGTH}
            placeholder="User can verify their email via a one-click link valid for 24h."
            className="w-full rounded-md text-[13px] outline-none px-2 py-1.5"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-hair)',
              color: 'var(--c-ink)',
              resize: 'vertical',
            }}
          />
        </FormField>

        <FormField label="Kind">
          <div className="flex items-center gap-3">
            {(['requirement', 'edge-case'] as const).map((k) => (
              <label
                key={k}
                className="text-[12px] flex items-center gap-1"
                style={{ color: 'var(--c-muted)' }}
              >
                <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
                {k}
              </label>
            ))}
          </div>
        </FormField>

        <FormField label="Tags (comma separated)">
          <input
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="m07, security"
            className="w-full rounded-md text-[13px] outline-none px-2 py-1.5"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-hair)',
              color: 'var(--c-ink)',
              fontFamily: 'ui-monospace, monospace',
            }}
          />
        </FormField>
      </FormShell>
    </Dialog>
  );
}
