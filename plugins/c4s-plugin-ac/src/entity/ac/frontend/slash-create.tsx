/**
 * `/ac` — the create-and-embed popover.
 *
 * Before 0.2.80 this was `CreateAcForm`, a host component registered in the
 * host's popover map under `'create-ac'` and woken by `slashInvoke`'s
 * `case 'ac'` arm. All three host pieces are gone: the command is declared on
 * the manifest with a `popoverKind`, the host dispatches the generic
 * `c4s:plugin-command`, and the popover mounts itself from this package's
 * frontend entry.
 *
 * The FORM is unchanged — the criterion, its kind, its tags, ⌘/Ctrl+Enter to
 * submit — and so is what happens on success: invalidate the list query, insert
 * a `single_element` embed at the caret, toast.
 */

import { createElement, useEffect, useRef, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { clientPluginHost } from '@c4s/plugin-runtime';
import {
  SlashPopoverShell,
  insertEmbed,
  mountSlashCreatePopover,
  useSlashSubmit,
  type CaretCoords,
  type EmbedEditor,
} from '../../../frontend-kit/slash-create.js';
import { FieldLabel, InlineError, PopoverFooter } from '../../../frontend-kit/popover-form.js';
import { toast } from '../../../frontend-kit/host-events.js';
import { AC_POPOVER_KIND, AC_TITLE_MAX_LENGTH, AC_TYPE } from '../../../identity.js';
import type { AcKind } from '../../../types.js';
import { keys as acKeys, useCreateAc } from './hooks.js';

/**
 * The tagging convention (see `acSystemPrompt.narrativeBlock`) applied to the
 * page the author is standing on, so `/ac` opens with the right tag already in
 * the box. Two axes:
 *
 *  - a host module page (`modules/mNN-*`) → `mNN`;
 *  - a page named for an entity type → `entity-{type}`.
 *
 * The second used to match `entities/<slug>.md`, a layout that stopped existing
 * once entity-type pages moved out into their own root — so it had quietly
 * stopped firing at all. It resolves the type by ASKING THE HOST rather than
 * munging the path: the pages are named for their plugin envelope as often as
 * for their type (`c4s-plugin-database-tables.md` holds `database-table`), so no
 * string rule gets it right.
 *
 * Deliberately NOT gated on a root id. Which root holds the entity-type pages is
 * each project's own naming choice (`plugins` here, `types` elsewhere), and a
 * hardcoded id makes the branch dead everywhere but one repo. The host lookup is
 * the real predicate: a page whose basename names no registered type pre-fills
 * nothing, which is the honest answer in any root.
 *
 * 0.2.80 — moved here verbatim from the host's `slashInvoke.ts`, which is also
 * where `currentPath` now comes from: it rides on the `c4s:plugin-command`
 * event, because nothing else on that event says where the caret is.
 */
export function detectAcDefaultTags(currentPath: string | null | undefined): string[] {
  if (!currentPath) return [];
  const m = currentPath.match(/^modules\/(m\d{2})-/i);
  if (m) return [m[1]!.toLowerCase()];
  const base = currentPath.split('/').pop()?.replace(/\.mdx?$/i, '') ?? '';
  if (base && clientPluginHost.getAvailable(base)) return [`entity-${base}`];
  return [];
}

function AcSlashCreateForm({
  editor,
  coords,
  currentPath,
  onClose,
}: {
  editor: EmbedEditor;
  coords: CaretCoords | null;
  currentPath: string | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AcKind>('requirement');
  const [tagsRaw, setTagsRaw] = useState(() => detectAcDefaultTags(currentPath).join(', '));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const create = useCreateAc();
  const qc = useQueryClient();

  useEffect(() => {
    const t = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const { error, setError, busy, submit } = useSlashSubmit(async () => {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Title is required');
    if (trimmed.length > AC_TITLE_MAX_LENGTH) {
      throw new Error(
        `${trimmed.length} characters — the limit is ${AC_TITLE_MAX_LENGTH}. A criterion this long ` +
          'is usually several criteria; split it.',
      );
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const ac = await create.mutateAsync({ title: trimmed, kind, ...(tags.length ? { tags } : {}) });
    // The FACTORY, not a hand-typed `['acs']`. The 0.2.18 review found two
    // popovers invalidating a key no list query used, a no-op masked by the
    // create hook's own invalidation.
    void qc.invalidateQueries({ queryKey: acKeys.all });
    insertEmbed(editor, AC_TYPE, ac.slug);
    toast.success('AC created');
    onClose();
    return ac;
  });

  return (
    <SlashPopoverShell
      width={400}
      title="New acceptance criterion"
      icon={<CheckSquare size={12} style={{ color: 'var(--c-accent)' }} />}
      coords={coords}
      onCancel={onClose}
    >
      <FieldLabel>Title (observable behavior)</FieldLabel>
      <textarea
        ref={titleRef}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          // Plain Enter is a newline: the criterion is a sentence that may wrap.
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

      <div className="mt-2 flex items-center gap-3">
        <FieldLabel>Kind</FieldLabel>
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

      <div className="mt-2">
        <FieldLabel>Tags (comma separated)</FieldLabel>
        <input
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="m07, security"
          className="w-full rounded-md text-[13px] outline-none px-2 py-1.5"
          style={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-hair)',
            color: 'var(--c-ink)',
            fontFamily: 'ui-monospace, monospace',
          }}
        />
      </div>

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

export function mountAcSlashCreate(): () => void {
  return mountSlashCreatePopover(AC_POPOVER_KIND, (props) =>
    createElement(AcSlashCreateForm, props),
  );
}
