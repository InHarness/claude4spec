import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRemoteAccount } from '../../../hooks/useRemoteAccount.js';
import { ApiError, remoteAccountApi } from '../../../lib/api.js';
import { confirmDestructive, toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

/**
 * M26 §1 — User section. Replaces the sidebar logout dropdown removed in this
 * release; this is the ONLY place Logout lives in the new UI. Logging out
 * invalidates both `remote-account` (sidebar slot) and `remote-project`
 * (linked-project card below).
 */
export function UserSettingsSection() {
  const { data, isLoading } = useRemoteAccount();
  const qc = useQueryClient();

  async function handleLogout() {
    const ok = await confirmDestructive({
      title: 'Log out of remote account?',
      body: 'You will need to log in again to push releases or load remote project info.',
      confirmLabel: 'Log out',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await remoteAccountApi.logout();
      qc.setQueryData(['remote-account'], r);
      qc.invalidateQueries({ queryKey: ['remote-project'] });
      toast.success('Logged out');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Logout failed');
    }
  }

  return (
    <SettingsCard
      id="user-section"
      title="User"
      description="Your remote account identity. Logging out revokes the local session only."
    >
      {isLoading ? (
        <div className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Loading…
        </div>
      ) : data?.connected ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate" style={{ color: 'var(--c-ink)' }}>
              {data.accountEmail ?? 'Connected'}
            </div>
            {data.accountStatus === 'deactivated' ? (
              <div className="text-[11px] mt-1" style={{ color: '#a87033' }}>
                Account deactivated — publishing is blocked
              </div>
            ) : (
              <div className="text-[11px] mt-1" style={{ color: 'var(--c-subtle)' }}>
                Active session
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          >
            <LogOut size={13} />
            Log out
          </button>
        </div>
      ) : (
        <div className="text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
          Not logged in. Use the sidebar “Log in” button to start a device flow.
        </div>
      )}
    </SettingsCard>
  );
}
