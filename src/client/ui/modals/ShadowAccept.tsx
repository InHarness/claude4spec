import { useState } from 'react';
import { Dialog } from '../../host-ui-kit/overlay/Dialog.js';
import { MAX_RELEASE_DESCRIPTION_LENGTH, releaseDescriptionLength } from '../../../shared/entities.js';
import type { ModalFormProps } from '../ModalHost.js';
import type { ModalProps } from '../events.js';

type Commit = ModalProps<'shadow-accept'>['commits'][number];

/**
 * The description suggested from the shadow's commit messages (subject, then
 * body), one message after another, trimmed and cut to
 * {@link MAX_RELEASE_DESCRIPTION_LENGTH} code points — the server's own
 * measure (`releaseDescriptionLength`).
 */
export function suggestShadowDescription(commits: readonly Commit[]): string {
  const messages = commits
    .map((c) => [c.subject.trim(), c.body.trim()].filter(Boolean).join('\n\n'))
    .filter(Boolean);
  return [...messages.join('\n\n').trim()].slice(0, MAX_RELEASE_DESCRIPTION_LENGTH).join('').trim();
}

/**
 * 2.1.47 (M17 L5 m17ui001) — the `shadow-accept` window: the name and the
 * description of the release that accepts the shadow. The description is
 * suggested from the preview's `commits`, with a visible code-point counter
 * against the 500 limit. „Accept & release” answers the window with the
 * fields; the screen sends `POST /api/shadow-accept` with the tip and HEAD SHAs
 * of the same preview answer and turns `shadow-accepting` for the request.
 */
export function ShadowAccept({ request, onClose }: ModalFormProps<'shadow-accept'>) {
  const { shadowId, tipSha, commits } = request.props;
  const [name, setName] = useState('');
  const [description, setDescription] = useState(() => suggestShadowDescription(commits));
  const length = releaseDescriptionLength(description);
  const tooLong = length > MAX_RELEASE_DESCRIPTION_LENGTH;
  const ready = name.trim().length > 0 && description.trim().length > 0 && !tooLong;

  function submit() {
    if (!ready) return;
    onClose({ name: name.trim(), description: description.trim() });
  }

  const label = {
    display: 'block',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: 600,
    marginBottom: 4,
    color: 'var(--c-subtle)',
  } as const;
  const field = {
    width: '100%',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    outline: 'none',
    background: 'var(--c-card)',
    border: '1px solid var(--c-hair)',
    color: 'var(--c-ink)',
  } as const;

  return (
    <Dialog
      open
      onClose={() => onClose(null)}
      title="Accept shadow"
      size="md"
      footer={
        <>
          <button
            type="button"
            data-shadow-accept-cancel
            onClick={() => onClose(null)}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 4, color: 'var(--c-muted)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-shadow-accept-submit
            onClick={submit}
            disabled={!ready}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              fontWeight: 500,
              background: 'var(--c-accent)',
              color: '#fff',
              opacity: ready ? 1 : 0.5,
            }}
          >
            Accept &amp; release
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--c-muted)', marginBottom: 12 }}>
        Merges the shadow <span className="font-mono">{shadowId}</span> @{' '}
        <span className="font-mono">{tipSha.slice(0, 7)}</span> into the specification and creates a release.
      </div>
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={label}>Release name</span>
        <input
          autoFocus
          data-shadow-accept-name
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="v1.0.0"
          style={field}
        />
      </label>
      <label style={{ display: 'block' }}>
        <span style={label}>Description</span>
        <textarea
          data-shadow-accept-description
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          style={{ ...field, resize: 'vertical' }}
        />
        <span
          data-shadow-accept-counter
          className="font-mono"
          style={{
            display: 'block',
            textAlign: 'right',
            fontSize: 11,
            marginTop: 2,
            color: tooLong ? '#dc2626' : 'var(--c-subtle)',
          }}
        >
          {length} / {MAX_RELEASE_DESCRIPTION_LENGTH}
        </span>
      </label>
    </Dialog>
  );
}
