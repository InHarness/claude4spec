/**
 * 2.1.62 (M54 L5) — the client of `/api/workspace/runner-hosts`. A workspace
 * route set: plain `fetch`, never the project prefix, so it answers on the
 * project-less workspace settings page. The card reads and writes ONLY here.
 */
import type {
  CreateRunnerHostRequest,
  RemoveRunnerHostResponse,
  RunnerHostResponse,
  RunnerHostStatus,
  TestRunnerHostRequest,
  UpdateRunnerHostRequest,
} from '../../shared/runner-hosts.js';
import { unwrap, unwrapList } from './api-core.js';

export type { RunnerHostResponse, RunnerHostStatus };

const BASE = '/api/workspace/runner-hosts';

/** M54 L5 `Zapytania`: one key, no filters; every mutation invalidates it. */
export const RUNNER_HOSTS_QUERY_KEY = ['runner-hosts'] as const;

/** L4 `Paginacja` caps a page at 200 — the card lists every host in one read. */
const LIST_LIMIT = 200;

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const runnerHostsApi = {
  async list(): Promise<RunnerHostResponse[]> {
    return unwrapList<RunnerHostResponse>(await fetch(`${BASE}?limit=${LIST_LIMIT}`));
  },
  async create(body: CreateRunnerHostRequest): Promise<RunnerHostResponse> {
    return unwrap<RunnerHostResponse>(await fetch(BASE, json('POST', body)));
  },
  async update(id: string, body: UpdateRunnerHostRequest): Promise<RunnerHostResponse> {
    return unwrap<RunnerHostResponse>(await fetch(`${BASE}/${encodeURIComponent(id)}`, json('PATCH', body)));
  },
  async test(id: string, body: TestRunnerHostRequest): Promise<RunnerHostResponse> {
    return unwrap<RunnerHostResponse>(await fetch(`${BASE}/${encodeURIComponent(id)}/test`, json('POST', body)));
  },
  async remove(id: string): Promise<RemoveRunnerHostResponse> {
    return unwrap<RemoveRunnerHostResponse>(await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  },
};

/** M54 `eqge2a8m`: the label of each of the ten statuses, as the card shows it. */
export const RUNNER_HOST_STATUS_LABEL: Record<RunnerHostStatus, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  unreachable: 'Unreachable',
  retrying: 'Retrying',
  stopped: 'Stopped',
  'token-rejected': 'Token rejected',
  'token-unreadable': 'Token unreadable',
  'protocol-mismatch': 'Protocol mismatch',
  'other-host': 'Different host',
  'bad-response': 'Bad response',
};

/**
 * The name a row and the remove confirmation use: the label, else the bound
 * `hostName`. ASSUMPTION:dev-5601 — a host never bound and without a label has
 * neither, so its address stands in.
 */
export function runnerHostName(host: RunnerHostResponse): string {
  return host.label || host.binding?.hostName || host.url;
}

/** `••••<last4>` (`eqge2a8m`); a record without a token shows the dots alone. */
export function maskedToken(host: RunnerHostResponse): string {
  return `••••${host.token.isSet && host.token.last4 ? host.token.last4 : ''}`;
}

export interface ToastOutcome {
  kind: 'success' | 'error';
  message: string;
}

/**
 * The toast after `[Test connection]` / `[Bind to this host]` (M54 `wzku2ck1`):
 * a rebind that bound a host with a new `hostId` → `Bound to …`; any other
 * connected answer → `Connected to …`; anything else → the failure with the
 * status label.
 */
export function testToast(before: RunnerHostResponse, after: RunnerHostResponse, rebind: boolean): ToastOutcome {
  if (after.status !== 'connected') {
    return { kind: 'error', message: `Connection test failed: ${RUNNER_HOST_STATUS_LABEL[after.status]}.` };
  }
  const name = after.binding?.hostName ?? runnerHostName(after);
  if (rebind && after.binding && before.binding?.hostId !== after.binding.hostId) {
    return { kind: 'success', message: `Bound to ${name}.` };
  }
  return { kind: 'success', message: `Connected to ${name}.` };
}

/**
 * The toast after saving an edit (M54 `wzku2ck1`, `l9ykuddq`): a new token whose
 * first attempt bound a different host than before → `Token accepted by a
 * different host — now bound to …`; every other save → `Runner host updated.`
 */
export function editToast(before: RunnerHostResponse, after: RunnerHostResponse, tokenChanged: boolean): ToastOutcome {
  if (tokenChanged && before.binding && after.binding && before.binding.hostId !== after.binding.hostId) {
    return {
      kind: 'success',
      message: `Token accepted by a different host — now bound to ${after.binding.hostName}.`,
    };
  }
  return { kind: 'success', message: 'Runner host updated.' };
}

/** Which form field a refused write is about — the route's message names it first (`url: …`). */
export function fieldOfError(code: string, message: string): 'url' | 'token' | 'label' | null {
  if (code === 'RUNNER_HOST_DUPLICATE') return 'url';
  const m = /^(url|token|label):/.exec(message);
  return m ? (m[1] as 'url' | 'token' | 'label') : null;
}
