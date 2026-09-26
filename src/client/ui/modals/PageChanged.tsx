import { Dialog } from '../../host-ui-kit/overlay/Dialog.js';
import type { ModalFormProps } from '../ModalHost.js';

const COPY = {
  'page-resolve': {
    title: 'Page changed on the server',
    body: 'This page was saved by someone else since you opened it. Reload to take the server version and discard your edits, or keep your changes?',
  },
  'page-reload': {
    title: 'File changed externally',
    body: 'This file was modified outside the editor. Reload and discard your unsaved changes, or keep them?',
  },
} as const;

/**
 * 0.2.110 M02 — the two "your copy is behind" windows, one anatomy:
 *
 * - `page-resolve`: an autosave came back `409 PAGE_CONFLICT`;
 * - `page-reload`: `file:changed` with `origin: 'external'` hit an open page
 *   holding unsaved edits (owned here, M40 only routes the event).
 *
 * Two branches: "Reload" (`'reload'`) discards the edits; "Keep my changes"
 * (`'keep'`) hands over to the `page-overwrite` confirm. Escape, the scrim and
 * ✕ resolve `null` — nothing is discarded and nothing is written.
 */
export function PageChanged({
  request,
  onClose,
}: ModalFormProps<'page-resolve'> | ModalFormProps<'page-reload'>) {
  const copy = COPY[request.kind as keyof typeof COPY];
  const close = onClose as (r: 'reload' | 'keep' | null) => void;
  return (
    <Dialog
      open
      onClose={() => close(null)}
      title={
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontWeight: 500 }}>
          {copy.title}
        </span>
      }
      width={420}
      footer={
        <>
          <button
            type="button"
            onClick={() => close('keep')}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 4, color: 'var(--c-muted)' }}
          >
            Keep my changes
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => close('reload')}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              fontWeight: 500,
              background: 'var(--c-accent)',
              color: '#fff',
            }}
          >
            Reload
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, color: 'var(--c-muted)', lineHeight: 1.5 }}>{copy.body}</div>
    </Dialog>
  );
}
