import { Dialog } from '../../host-ui-kit/overlay/Dialog.js';
import type { ModalFormProps } from '../ModalHost.js';

type ChoiceProps = ModalFormProps<'onboarding-skip'> | ModalFormProps<'release-push'>;

function copyOf(request: ChoiceProps['request']): {
  title: string;
  body: string;
  confirmLabel: string;
} {
  if (request.kind === 'release-push') {
    const { projectName } = request.props as { projectName: string };
    return {
      title: `Create remote project '${projectName}'`,
      body: 'This is your first push. A new project will be created on the remote server with this name. Subsequent pushes will go to the same project.',
      confirmLabel: 'Create and push',
    };
  }
  return {
    title: 'Skip onboarding?',
    body: 'To re-run onboarding later, set onboardingCompleted: false in .claude4spec/config.json, then re-activate this project in the switcher (or restart the server). Editing the file alone won’t trigger it — claude4spec doesn’t watch .claude4spec/.',
    confirmLabel: 'Skip anyway',
  };
}

/**
 * 0.2.110 — non-destructive two-button windows: `onboarding-skip` (M16, `[Skip]`
 * on onboarding) and `release-push` (M25, the first push of a release). The
 * confirm answers `true`; Cancel, Escape, the scrim and ✕ answer `null`.
 */
export function ChoiceModal({ request, onClose }: ChoiceProps) {
  const copy = copyOf(request);
  const close = onClose as (r: true | null) => void;
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
            onClick={() => close(null)}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 4, color: 'var(--c-muted)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => close(true)}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              fontWeight: 500,
              background: 'var(--c-accent)',
              color: '#fff',
            }}
          >
            {copy.confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, color: 'var(--c-muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {copy.body}
      </div>
    </Dialog>
  );
}
