import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../host-ui-kit/actions/Badge.js';
import { ActionButton } from '../../host-ui-kit/actions/ActionButton.js';
import { EmptyState } from '../../host-ui-kit/list/EmptyState.js';
import { useToast } from '../../host-ui-kit/overlay-feedback/useToast.js';
import { confirmDestructive, openModal } from '../../ui/events.js';
import {
  RUNNER_HOST_STATUS_LABEL,
  RUNNER_HOSTS_QUERY_KEY,
  editToast,
  maskedToken,
  runnerHostName,
  runnerHostsApi,
  testToast,
  type RunnerHostResponse,
  type RunnerHostStatus,
  type ToastOutcome,
} from '../../lib/runner-hosts.js';

/** M54 L5 `wzku2ck1`: the card polls every 5 s while it is on screen. */
export const RUNNER_HOSTS_POLL_MS = 5_000;

/** M54 L17 `cx6b7xjn`: the card note. */
export const RUNNER_HOSTS_HTTP_NOTE = 'Tokens sent to http:// addresses travel unencrypted.';

/** M54 `eqge2a8m` / `75pb3ugi`: the hint under a `Token rejected` badge. */
export const TOKEN_REJECTED_HINT =
  'The runner rejected the token, or cannot read its token store. Fix it on the host, then use Test connection.';

const RED = 'var(--c-red, #c45a3b)';
const AMBER = '#a87033';

const STATUS_INK: Record<RunnerHostStatus, string> = {
  connecting: 'var(--c-muted)',
  connected: 'var(--c-accent)',
  unreachable: RED,
  retrying: AMBER,
  stopped: AMBER,
  'token-rejected': RED,
  'token-unreadable': RED,
  'protocol-mismatch': RED,
  'other-host': AMBER,
  'bad-response': RED,
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Whether the element is on screen. Starts `true` (a browser without
 * `IntersectionObserver` polls while mounted); the observer turns it off while
 * the card is scrolled away, so the 5 s poll runs only when the card is visible.
 */
function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setOnScreen(last.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, onScreen] as const;
}

/**
 * M54 L17 `cx6b7xjn` / `eqge2a8m` — the `Runner host list` element of the
 * workspace card `#runner-hosts` (its own component; storage outside the config
 * file: the records in the workspace registry entry, on the server). It reads
 * and writes only through `/api/workspace/runner-hosts`: the list under the key
 * `["runner-hosts"]`, polled every 5 s while the card is on screen (no WS event
 * map), invalidated after every mutation (M54 L5 `wzku2ck1`).
 */
export function RunnerHostsElement() {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const { data, isError } = useQuery({
    queryKey: RUNNER_HOSTS_QUERY_KEY,
    queryFn: () => runnerHostsApi.list(),
    refetchInterval: onScreen ? RUNNER_HOSTS_POLL_MS : false,
  });
  const queryClient = useQueryClient();
  const toast = useToast();

  const refresh = () => queryClient.invalidateQueries({ queryKey: RUNNER_HOSTS_QUERY_KEY });
  const show = (o: ToastOutcome) => (o.kind === 'success' ? toast.success(o.message) : toast.error(o.message));

  async function add() {
    const host = await openModal('runner-host-create', {});
    if (!host) return;
    await refresh();
    toast.success('Runner host added.');
  }

  async function edit(host: RunnerHostResponse) {
    const result = await openModal('runner-host-edit', { host });
    if (!result) return;
    await refresh();
    show(editToast(host, result.host, result.tokenChanged));
  }

  async function remove(host: RunnerHostResponse) {
    const name = runnerHostName(host);
    await confirmDestructive('runner-host-remove', {
      title: 'Remove runner host',
      body: `Remove runner host ${name}? The token stored for it is deleted.`,
      confirmLabel: 'Remove',
      action: async () => {
        try {
          await runnerHostsApi.remove(host.id);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not remove the runner host.');
          return false;
        }
        await refresh();
        toast.success('Runner host removed.');
        return true;
      },
    });
  }

  async function test(host: RunnerHostResponse, rebind: boolean) {
    try {
      const after = await runnerHostsApi.test(host.id, rebind ? { rebind: true } : {});
      show(testToast(host, after, rebind));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection test failed.');
    }
    await refresh();
  }

  return (
    <div ref={ref} className="flex flex-col gap-3" data-testid="runner-hosts">
      {isError ? (
        <p className="text-[12px]" style={{ color: RED }}>
          Could not load runner hosts.
        </p>
      ) : !data ? (
        <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Loading runner hosts…
        </p>
      ) : data.length === 0 ? (
        <EmptyState
          title="No runner hosts yet"
          action={<ActionButton label="Add runner host" variant="primary" onClick={() => void add()} />}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {data.map((host) => (
              <RunnerHostRow
                key={host.id}
                host={host}
                onTest={(rebind) => test(host, rebind)}
                onEdit={() => void edit(host)}
                onRemove={() => void remove(host)}
              />
            ))}
          </div>
          {/* ASSUMPTION:dev-5601 — the spec names the button only in the empty state; a second host needs it too. */}
          <div>
            <ActionButton label="Add runner host" onClick={() => void add()} />
          </div>
        </>
      )}
      <p className="text-[11.5px]" style={{ color: 'var(--c-subtle)' }} data-testid="runner-hosts-note">
        {RUNNER_HOSTS_HTTP_NOTE}
      </p>
    </div>
  );
}

function RunnerHostRow({
  host,
  onTest,
  onEdit,
  onRemove,
}: {
  host: RunnerHostResponse;
  onTest: (rebind: boolean) => Promise<void>;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const run = (rebind: boolean) => {
    if (testing) return;
    setTesting(true);
    void onTest(rebind).finally(() => setTesting(false));
  };

  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
      data-testid="runner-host-row"
      data-host-id={host.id}
      data-status={host.status}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="min-w-0 truncate text-[13px] font-medium" style={{ color: 'var(--c-ink)' }} data-testid="runner-host-name">
          {runnerHostName(host)}
        </span>
        <span className="min-w-0 truncate text-[11.5px] font-mono" style={{ color: 'var(--c-subtle)' }} data-testid="runner-host-url">
          {host.url}
        </span>
        <span className="flex-1" />
        <span className="text-[11.5px] font-mono" style={{ color: 'var(--c-muted)' }} data-testid="runner-host-token">
          {maskedToken(host)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
        <span data-testid="runner-host-status">
          <Badge small label={RUNNER_HOST_STATUS_LABEL[host.status]} foreground={STATUS_INK[host.status]} />
        </span>
        <span data-testid="runner-host-status-since">since {formatTime(host.statusSince)}</span>
        {host.binding ? <span data-testid="runner-host-version">v{host.binding.runnerVersion}</span> : null}
        {host.restartedAt ? (
          <span data-testid="runner-host-restarted" style={{ color: AMBER }}>
            Restarted {formatTime(host.restartedAt)}
          </span>
        ) : null}
      </div>

      {host.lastError ? (
        <div className="mt-1 text-[11.5px]" style={{ color: 'var(--c-muted)' }} data-testid="runner-host-last-error">
          {host.lastError.message}
        </div>
      ) : null}
      {host.status === 'token-rejected' ? (
        <div className="mt-1 text-[11.5px]" style={{ color: RED }} data-testid="runner-host-token-rejected-hint">
          {TOKEN_REJECTED_HINT}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <ActionButton label={testing ? 'Testing…' : 'Test connection'} disabled={testing} onClick={() => run(false)} />
        {host.status === 'other-host' ? (
          <ActionButton label="Bind to this host" variant="primary" disabled={testing} onClick={() => run(true)} />
        ) : null}
        <ActionButton label="Edit" variant="ghost" onClick={onEdit} />
        <ActionButton label="Remove" variant="ghost" onClick={onRemove} />
      </div>
    </div>
  );
}
