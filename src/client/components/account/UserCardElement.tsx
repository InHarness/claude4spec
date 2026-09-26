import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRemoteAccount } from '../../hooks/useRemoteAccount.js';
import { ApiError, remoteAccountApi } from '../../lib/api.js';
import { confirmDestructive, toast } from '../../ui/events.js';
import { DEACTIVATED_TOOLTIP, REMOTE_LOGIN_START_EVENT, initialsFor } from '../UserSection.js';
import type { SettingsContribution } from '../settings/registry.js';

/**
 * 0.2.113 — the remote-account module's card (§4.1).
 *
 * Connected: avatar initials, e-mail and `connected_at`, the amber badge when the
 * account is deactivated, and [Log out]. Not connected: an empty state and
 * [Log in], which starts the SAME device flow as the header slot — the code, the
 * polling and the cancel live in that slot, not here. While that flow runs the
 * account is still `connected: false`, so this card never offers [Log out] then.
 */
export const REMOTE_ACCOUNT_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'user-section',
      title: 'User',
      description: 'Your remote account identity. Logging out removes the local session only.',
      group: 'Account',
      weight: 10,
      owner: 'remote-account',
    },
  ],
  elements: [
    {
      id: 'remote-account',
      card: 'user-section',
      weight: 10,
      kind: 'custom',
      owner: 'remote-account',
      component: UserCardElement,
    },
  ],
};

function UserCardElement() {
  const { data, isLoading } = useRemoteAccount();
  const qc = useQueryClient();

  async function handleLogout() {
    const email = data?.accountEmail ?? 'the remote account';
    const ok = await confirmDestructive({
      kind: 'account-logout',
      title: 'Log out',
      body: `Log out of ${email}? The session token will be removed locally.`,
      confirmLabel: 'Log out',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await remoteAccountApi.logout();
      // Broad prefixes: the slot, this card, and the remote project (which now
      // refetches without a bearer) all move to the signed-out view in place.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['remote-account'] }),
        qc.invalidateQueries({ queryKey: ['remote-project'] }),
      ]);
      toast.success('Logged out');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Logout failed');
    }
  }

  if (isLoading) {
    return (
      <div className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
        Loading…
      </div>
    );
  }

  if (!data?.connected) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
          You are not signed in to a remote account.
        </span>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(REMOTE_LOGIN_START_EVENT))}
          className="rounded-md px-3 py-1.5 text-[12px] font-medium"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          Log in
        </button>
      </div>
    );
  }

  const email = data.accountEmail ?? '';
  const deactivated = data.accountStatus === 'deactivated';
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ width: 34, height: 34, background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }}
          aria-hidden
        >
          {initialsFor(email)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium truncate" style={{ color: 'var(--c-ink)' }}>
              {email || 'Connected'}
            </span>
            {deactivated ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                style={{ background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }}
                title={DEACTIVATED_TOOLTIP}
              >
                deactivated
              </span>
            ) : null}
          </div>
          {data.connectedAt ? (
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
              Connected {new Date(data.connectedAt).toLocaleString()}
            </div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleLogout()}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium"
        style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
      >
        <LogOut size={13} />
        Log out
      </button>
    </div>
  );
}
