import React from 'react';
import { createRoot } from 'react-dom/client';
import { Code2 } from 'lucide-react';
import {
  CODE_SNIPPET_TYPE,
  DEFAULT_LANGUAGE,
  LANGUAGE_ALIASES,
} from '../../../identity.js';
import { toast } from '../../../frontend-kit/host-events.js';
import {
  SlashPopoverShell,
  useSlashSubmit,
  type CaretCoords,
  type EmbedEditor,
} from '../../../frontend-kit/slash-create.js';
import { createCodeSnippet, updateCodeSnippet, type CodeSnippet } from './hooks.js';
import { CodeSnippetView } from './view.js';

/**
 * The languages offered as suggestions.
 *
 * A `<datalist>`, NOT a `<select>`: the field is a free string by design, so the
 * UI must not imply a closed set. Every alias key is listed beside its target so
 * an author typing `ts` sees it is a known spelling rather than a typo.
 */
const SUGGESTIONS = [
  'typescript',
  'javascript',
  'python',
  'bash',
  'json',
  'yaml',
  'markdown',
  'sql',
  'xml',
  'css',
  'go',
  'rust',
  'java',
  'diff',
  DEFAULT_LANGUAGE,
];

/**
 * The host's normalization, mirrored for the PREVIEW ONLY.
 *
 * The server is the authority — it applies the same table through the schema's
 * `normalize` declaration on the generic write path. This exists so the preview
 * can show the effect before the round trip, and it reads `LANGUAGE_ALIASES`,
 * the same constant the schema declares, so the two cannot drift into
 * disagreeing about what `sh` means.
 */
function previewNormalize(raw: string): string {
  const folded = raw.trim().toLowerCase();
  return LANGUAGE_ALIASES[folded] ?? folded;
}

export interface CodeSnippetDraft {
  title: string;
  language: string;
  filename: string;
  caption: string;
  code: string;
}

const EMPTY: CodeSnippetDraft = { title: '', language: '', filename: '', caption: '', code: '' };

function labelStyle(): React.CSSProperties {
  return {
    color: 'var(--c-subtle)',
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    background: 'var(--c-card)',
    border: '1px solid var(--c-hair)',
    borderRadius: 4,
    color: 'var(--c-ink)',
    padding: '4px 6px',
    fontSize: 12,
  };
}

/**
 * The two-column create/edit form, modelled on the diagram popover: fields on
 * the left, a live `CodeSnippetView` on the right.
 *
 * The preview is debounced 300 ms and is the reason `Language` shows its effect
 * immediately — an author typing `TS` watches it resolve to `typescript`, and an
 * author typing something the highlighter has never heard of watches the block
 * fall back to plaintext without anything resembling an error.
 *
 * `Caption` sits among the fields but is NOT a field of the entity. It is
 * written onto the reference in the markdown. Keeping it here is a deliberate
 * ergonomic choice — an author thinks of "the caption on this embed" while
 * writing the embed — and the save path is what keeps the two apart.
 */
function CodeSnippetForm({
  mode,
  initial,
  captionEditable,
  coords,
  onSave,
  onRemove,
  onClose,
}: {
  mode: 'create' | 'edit';
  initial: CodeSnippetDraft;
  captionEditable: boolean;
  coords: CaretCoords | null;
  onSave: (draft: CodeSnippetDraft) => Promise<void>;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = React.useState<CodeSnippetDraft>(initial);
  const [preview, setPreview] = React.useState(initial);

  React.useEffect(() => {
    const t = window.setTimeout(() => setPreview(draft), 300);
    return () => window.clearTimeout(t);
  }, [draft]);

  const { error, busy, submit } = useSlashSubmit(async () => {
    await onSave(draft);
    onClose();
  });

  const set = (key: keyof CodeSnippetDraft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const canSave = draft.title.trim() !== '' && draft.code.trim() !== '' && !busy;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSave) void submit();
    }
  };

  return (
    <SlashPopoverShell
      width={760}
      title={mode === 'create' ? 'Insert code snippet' : 'Edit code snippet'}
      icon={<Code2 size={12} />}
      coords={coords}
      onCancel={onClose}
    >
      <div className="flex gap-3" onKeyDown={onKeyDown}>
        <div className="flex w-[300px] shrink-0 flex-col gap-2">
          <label className="flex flex-col gap-0.5">
            <span style={labelStyle()}>Title</span>
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => set('title')(e.target.value)}
              placeholder="EntityContribution manifest"
              style={inputStyle()}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span style={labelStyle()}>Language</span>
            <input
              value={draft.language}
              onChange={(e) => set('language')(e.target.value)}
              placeholder={DEFAULT_LANGUAGE}
              list="c4s-code-snippet-languages"
              style={inputStyle()}
            />
            <datalist id="c4s-code-snippet-languages">
              {SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>

          <label className="flex flex-col gap-0.5">
            <span style={labelStyle()}>Filename</span>
            <input
              value={draft.filename}
              onChange={(e) => set('filename')(e.target.value)}
              placeholder="src/manifest.ts"
              style={inputStyle()}
            />
          </label>

          {captionEditable && (
            <label className="flex flex-col gap-0.5">
              <span style={labelStyle()}>Caption (this reference)</span>
              <input
                value={draft.caption}
                onChange={(e) => set('caption')(e.target.value)}
                placeholder="Manifest of the package"
                style={inputStyle()}
              />
            </label>
          )}

          <label className="flex flex-col gap-0.5">
            <span style={labelStyle()}>Code</span>
            <textarea
              value={draft.code}
              onChange={(e) => set('code')(e.target.value)}
              rows={14}
              spellCheck={false}
              onKeyDown={(e) => {
                /*
                 * Tab inserts a tab instead of leaving the field. In a code
                 * textarea losing focus on Tab is the wrong default hard enough
                 * to be worth overriding — but only bare Tab: Shift+Tab and the
                 * modifier combinations still move focus, so the form stays
                 * escapable by keyboard.
                 */
                if (e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: s, selectionEnd: t, value } = el;
                const next = `${value.slice(0, s)}\t${value.slice(t)}`;
                set('code')(next);
                window.requestAnimationFrame(() => {
                  el.selectionStart = el.selectionEnd = s + 1;
                });
              }}
              style={{
                ...inputStyle(),
                fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
                resize: 'vertical',
              }}
            />
          </label>

          {error && (
            <div className="text-[11px]" style={{ color: 'var(--c-red)' }}>
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-[11.5px]"
              style={{ border: '1px solid var(--c-hair)', color: 'var(--c-muted)' }}
            >
              Cancel
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => {
                  onRemove();
                  onClose();
                }}
                className="rounded px-2 py-1 text-[11.5px]"
                style={{ border: '1px solid var(--c-hair)', color: 'var(--c-red)' }}
                /* Removes the REFERENCE. The entity survives — it may well be
                   embedded on other pages, and deleting it from here would be a
                   destructive act disguised as tidying up one page. */
                title="Remove this embed (the snippet itself is kept)"
              >
                Remove
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void submit()}
              className="rounded px-2.5 py-1 text-[11.5px]"
              style={{
                background: canSave ? 'var(--c-accent)' : 'var(--c-hair)',
                color: canSave ? '#fff' : 'var(--c-subtle)',
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div
          className="min-w-0 flex-1 overflow-hidden rounded"
          style={{ border: '1px solid var(--c-hair)' }}
        >
          <CodeSnippetView
            code={preview.code}
            language={previewNormalize(preview.language)}
            maxHeight={360}
            hideCopy
          />
        </div>
      </div>
    </SlashPopoverShell>
  );
}

/** Turn a draft into the entity payload — dropping `caption`, which is not a field. */
function toInput(draft: CodeSnippetDraft) {
  const filename = draft.filename.trim();
  return {
    title: draft.title.trim(),
    language: draft.language.trim(),
    // `clearable`, so an emptied filename must be sent as `null` rather than
    // omitted — omitting it would leave the previous value in place.
    filename: filename === '' ? null : filename,
    code: draft.code,
  };
}

/**
 * Serialize the embed tag.
 *
 * Attribute order is `type, slug, caption` — the host's own `ATTR_ORDER` for
 * `single_element` — and an absent caption is OMITTED rather than written as
 * `caption=""`, so a markdown → tiptap → markdown round trip converges.
 */
function embedAttrs(slug: string, caption: string): Record<string, unknown> {
  const trimmed = caption.trim();
  return { type: CODE_SNIPPET_TYPE, slug, caption: trimmed === '' ? null : trimmed };
}

/** The `/code-snippet` slash-create form: makes the entity, then inserts the embed. */
export function CodeSnippetCreatePopover({
  editor,
  coords,
  onClose,
}: {
  editor: EmbedEditor;
  coords: CaretCoords | null;
  onClose: () => void;
}) {
  return (
    <CodeSnippetForm
      mode="create"
      initial={EMPTY}
      captionEditable
      coords={coords}
      onClose={onClose}
      onSave={async (draft) => {
        const created = await createCodeSnippet(toInput(draft));
        editor
          .chain()
          .focus()
          .insertContent({ type: 'single_element', attrs: embedAttrs(created.slug, draft.caption) })
          .run();
        toast.success(`Code snippet “${created.title}” created`);
      }}
    />
  );
}

/**
 * The card's edit popover, mounted imperatively.
 *
 * Imperative rather than declarative because the trigger is an Alt+click deep
 * inside a Tiptap node view, where there is no convenient place to hang popover
 * state that survives the editor's own re-renders. Same shape as the
 * slash-create mount, minus the event subscription.
 *
 * NOTE — the caption is read-only here: editing it requires `updateAttributes`
 * on the ProseMirror node, and this entry point does not hold the node. The card
 * therefore passes `captionEditable: false`. Changing a caption is done by
 * re-inserting the embed; see the patch filed against the brief.
 */
export function openEditPopover({
  entity,
  caption,
  onSaved,
}: {
  entity: CodeSnippet;
  caption?: string;
  onSaved: () => void;
}): void {
  if (typeof document === 'undefined') return;
  const host = document.createElement('div');
  host.dataset.plugin = 'code-snippet-edit';
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(
    <CodeSnippetForm
      mode="edit"
      initial={{
        title: entity.title,
        language: entity.language ?? '',
        filename: entity.filename ?? '',
        caption: caption ?? '',
        code: entity.code,
      }}
      captionEditable={false}
      coords={null}
      onClose={close}
      onSave={async (draft) => {
        await updateCodeSnippet(entity.slug, toInput(draft));
        onSaved();
        toast.success('Code snippet updated');
      }}
    />,
  );
}
