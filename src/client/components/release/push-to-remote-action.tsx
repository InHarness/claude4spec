import { UploadCloud } from 'lucide-react';
import {
  registerReleaseAction,
  type ReleaseActionContext,
} from '../../lib/release-actions/registry.js';
import { useConfig } from '../../hooks/useConfig.js';
import { useRemoteAccount } from '../../hooks/useRemoteAccount.js';
import { usePushRelease } from '../../hooks/useReleasePushes.js';
import { openModal, surfaceGitSync, toast } from '../../ui/events.js';

/**
 * M25 "Push to remote" — a release action rendered as an item in the release
 * detail `…` menu (registered in the M17 actions registry). Gated on the M24
 * session: disabled with a tooltip when not connected or deactivated. First push
 * (`config.remoteProjectId === null`) asks for confirmation (a new remote project
 * is created); subsequent pushes are single-click. Feedback via toasts, with a
 * distinct message for a deduplicated hit.
 */
function PushToRemoteMenuItem({ release, onClose }: ReleaseActionContext) {
  const { data: config } = useConfig();
  const { data: account } = useRemoteAccount();
  const push = usePushRelease();

  const connected = account?.connected ?? false;
  const deactivated = account?.accountStatus === 'deactivated';
  const disabled = !connected || deactivated || push.isPending;

  const tooltip = !connected
    ? 'Log in to push to the remote server.'
    : deactivated
      ? 'Account deactivated — push disabled. Contact your administrator.'
      : 'Push this release to the remote server';

  async function onClick() {
    if (disabled) return;
    onClose?.();
    const firstPush = (config?.remoteProjectId ?? null) === null;
    if (firstPush) {
      const ok = await openModal('release-push', {
        releaseName: release.name,
        projectName: config?.name ?? '',
      });
      if (!ok) return;
    }
    try {
      const res = await push.mutateAsync(release.name);
      const seq = res.remoteReleaseSequence;
      if (res.deduplicated) toast.info(`Already pushed as release #${seq}`);
      else toast.success(`Pushed as release #${seq}`);
      // M28: git push-sync is best-effort — never contradicts the successful
      // remote push above. 2.1.14: only `status: 'error'` reacts (the
      // `git-sync-recover` window); `pushed` / `nothing-to-push` / `skipped` /
      // `null` add no signal of their own — the toast above is the remote
      // push's, not git's.
      surfaceGitSync(res.gitSync);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12.5px]"
      style={{
        color: 'var(--c-muted)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--c-panel)';
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <UploadCloud size={13} />
      {push.isPending ? 'Pushing…' : 'Push to remote'}
    </button>
  );
}

registerReleaseAction({
  id: 'push-to-remote',
  label: 'Push to remote',
  render: (ctx) => <PushToRemoteMenuItem {...ctx} />,
});
