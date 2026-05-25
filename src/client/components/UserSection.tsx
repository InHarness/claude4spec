import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, LogOut } from 'lucide-react';
import { ApiError, remoteAccountApi } from '../lib/api.js';
import { toast } from '../ui/events.js';
import { useRemoteAccount } from '../hooks/useRemoteAccount.js';
import type { DeviceLoginPollResponse } from '../../shared/remote-account.js';

/** Active device-flow state (client-side). `nonce` keys the polling effect so a
 *  fresh start restarts the loop. */
interface Flow {
  nonce: number;
  userCode: string;
  verificationUriComplete: string;
  interval: number;
}

/**
 * M24 sidebar "User" slot. Three states: logged-out / device flow in progress
 * (inline, no modal) / logged-in. Reserves a constant ~56px height so the
 * layout does not jump between logged-out and logged-in.
 */
export function UserSection() {
  const { data } = useRemoteAccount();
  const qc = useQueryClient();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [starting, setStarting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // --- polling loop while a device flow is active --------------------------
  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentInterval = flow.interval;

    const schedule = (sec: number) => {
      timer = setTimeout(tick, Math.max(1, sec) * 1000);
    };

    const finish = (msg: string, kind: 'success' | 'error', account?: DeviceLoginPollResponse['account']) => {
      if (kind === 'success') {
        if (account) qc.setQueryData(['remote-account'], account);
        else void qc.invalidateQueries({ queryKey: ['remote-account'] });
        toast.success(msg);
      } else {
        toast.error(msg);
      }
      setFlow(null);
    };

    const tick = async () => {
      if (cancelled) return;
      let res: DeviceLoginPollResponse;
      try {
        res = await remoteAccountApi.poll();
      } catch (err) {
        if (cancelled) return;
        // Lost flow (e.g. server restart) or transport error → back to start.
        finish(err instanceof ApiError ? err.message : 'Login failed', 'error');
        return;
      }
      if (cancelled) return;
      switch (res.status) {
        case 'pending':
          schedule(currentInterval);
          break;
        case 'slow_down':
          if (res.interval) currentInterval = res.interval;
          schedule(currentInterval);
          break;
        case 'authorized':
          finish(`Connected as ${res.account?.accountEmail ?? 'account'}`, 'success', res.account);
          break;
        case 'expired':
          finish('Code expired — try again', 'error');
          break;
        case 'denied':
          finish('Authorization denied', 'error');
          break;
        case 'invalid':
          finish(res.message ?? 'Login invalid — try again', 'error');
          break;
      }
    };

    schedule(currentInterval);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [flow, qc]);

  async function handleLogin() {
    setStarting(true);
    try {
      const r = await remoteAccountApi.startLogin();
      setFlow({
        nonce: Date.now(),
        userCode: r.user_code,
        verificationUriComplete: r.verification_uri_complete,
        interval: r.interval,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start login');
    } finally {
      setStarting(false);
    }
  }

  async function handleLogout() {
    setMenuOpen(false);
    try {
      const r = await remoteAccountApi.logout();
      qc.setQueryData(['remote-account'], r);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Logout failed');
    }
  }

  const shell =
    'w-full px-3.5 py-2 flex flex-col justify-center';
  const shellStyle = { minHeight: 56, borderBottom: '1px solid var(--c-hair)' } as const;

  // --- State 2: device flow in progress ------------------------------------
  if (flow) {
    return (
      <div className={shell} style={shellStyle}>
        <div className="flex items-center gap-1.5 text-[10.5px] mb-1" style={{ color: 'var(--c-subtle)' }}>
          <Loader2 size={11} className="animate-spin" />
          <span>Waiting for authorization…</span>
        </div>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(flow.userCode);
            toast.info('Code copied');
          }}
          className="text-[15px] font-mono font-semibold tracking-wider select-all text-left leading-tight"
          style={{ color: 'var(--c-ink)' }}
          title="Click to copy"
        >
          {flow.userCode}
        </button>
        <div className="flex items-center gap-3 mt-1">
          <a
            href={flow.verificationUriComplete}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10.5px]"
            style={{ color: 'var(--c-accent)' }}
          >
            <ExternalLink size={10} /> Open verification page
          </a>
          <button
            onClick={() => setFlow(null)}
            className="text-[10.5px]"
            style={{ color: 'var(--c-muted)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --- State 3: logged in ---------------------------------------------------
  if (data?.connected) {
    const email = data.accountEmail ?? '';
    const initials = initialsFor(email);
    const deactivated = data.accountStatus === 'deactivated';
    return (
      <div className={shell} style={shellStyle}>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-full flex items-center gap-2 text-left"
            title={deactivated ? 'Account deactivated — publishing blocked' : email}
          >
            <span className="relative inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{
                width: 28,
                height: 28,
                background: 'var(--c-accent-soft)',
                color: 'var(--c-accent)',
                opacity: deactivated ? 0.55 : 1,
              }}
            >
              {initials}
              {deactivated && (
                <span
                  className="absolute -top-0.5 -right-0.5 rounded-full"
                  style={{ width: 8, height: 8, background: '#a87033', border: '1.5px solid var(--c-panel)' }}
                />
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[11.5px] truncate" style={{ color: 'var(--c-ink)' }}>
                {email || 'Connected'}
              </span>
              {deactivated && (
                <span className="block text-[9.5px]" style={{ color: '#a87033' }}>
                  account deactivated
                </span>
              )}
            </span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div
                className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md py-1 shadow-lg"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
              >
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-left"
                  style={{ color: 'var(--c-ink)' }}
                >
                  <LogOut size={12} /> Log out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // --- State 1: logged out --------------------------------------------------
  return (
    <div className={shell} style={shellStyle}>
      <button
        onClick={handleLogin}
        disabled={starting}
        className="w-full rounded-md px-3 py-1.5 text-[11.5px] font-medium"
        style={{ background: 'var(--c-accent)', color: '#fff', opacity: starting ? 0.6 : 1 }}
      >
        {starting ? 'Connecting…' : 'Log in'}
      </button>
    </div>
  );
}

/** 1–2 chars before `@`, uppercase; `?` fallback. */
function initialsFor(email: string): string {
  const local = email.split('@')[0] ?? '';
  const cleaned = local.replace(/[^a-zA-Z0-9]/g, '');
  if (!cleaned) return '?';
  return cleaned.slice(0, 2).toUpperCase();
}
