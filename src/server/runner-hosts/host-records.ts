import { randomUUID } from 'node:crypto';
import { encrypt } from '../services/agent-credential-crypto.js';
import { WorkspaceEntryGoneError, type WorkspaceRegistry } from '../workspace/registry.js';
import type { StoredWorkspaceRecord, WorkspaceRecord } from '../workspace/types.js';
import { normalizeHostUrl, normalizeMasterToken, RunnerHostError, tokenLast4 } from './host-input.js';

/**
 * M54 `fo9bukuw`: the binding to the host, rewritten from its HostInfo
 * (`hostName` is HostInfo's `name`); `null` until the first successful attempt
 * and again after a new token is saved.
 */
export interface RunnerHostBinding {
  hostId: string;
  hostName: string;
  runnerVersion: string;
  /** The `startedAt` seen last. */
  startedAt: string;
}

/**
 * M54 `fo9bukuw`: a runner-host record as it lies in `runnerHosts[]` of the
 * workspace's registry entry — configuration and binding only (`4pxwyo22`).
 * The token is never stored in plain text: `tokenCiphertext` is the M05 secrets
 * primitive's format, `tokenLast4` is not a secret.
 */
export interface RunnerHostRecord {
  /** Local id, given on add, never changed. */
  id: string;
  /** Normalized base address (`kqxtylk6`), unique within the entry. */
  url: string;
  label?: string;
  tokenCiphertext: string;
  tokenLast4: string;
  binding: RunnerHostBinding | null;
}

export interface AddRunnerHostInput {
  url: string;
  token: string;
  label?: string;
}

/** `undefined` leaves a field as it is. */
export interface UpdateRunnerHostInput {
  url?: string;
  token?: string;
  label?: string;
}

type WorkspaceKey = Pick<WorkspaceRecord, 'name' | 'home'>;

function isRecord(value: unknown): value is RunnerHostRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<RunnerHostRecord>;
  return typeof r.id === 'string' && typeof r.url === 'string';
}

/**
 * The runner-host records of an entry's `runnerHosts[]` (the stored entry, or
 * the workspace view at start): entries that are not records are skipped.
 */
export function runnerHostRecordsOf(hosts: unknown[] | undefined): RunnerHostRecord[] {
  return (hosts ?? []).filter(isRecord).map(copy);
}

function sameUrl(stored: string, normalized: string): boolean {
  try {
    return normalizeHostUrl(stored) === normalized;
  } catch {
    return stored === normalized;
  }
}

/** Trimmed label; empty means "no label". */
function normalizeLabel(label: string): string | undefined {
  const trimmed = label.trim();
  return trimmed || undefined;
}

function copy(record: RunnerHostRecord): RunnerHostRecord {
  return { ...record, binding: record.binding ? { ...record.binding } : null };
}

/**
 * M54 `4pxwyo22`: the store of runner-host records in `runnerHosts[]` of one
 * workspace's registry entry. Every write is an operation on ONE record (add,
 * change, remove, update binding) on the freshly read file, with the M31
 * entry-write guarantee (`WorkspaceRegistry.updateEntry`: read-modify-write
 * under the registry lock, unknown fields kept). A write never replaces the
 * whole list from a view in memory — a process's view does not see another
 * process's changes, so that would delete or resurrect their records. The
 * duplicate check runs on the file, not on a view; a binding update never
 * inserts a record that is no longer in the file.
 *
 * Inputs are validated and the token encrypted BEFORE the lock is taken, so a
 * refusal writes nothing and the lock is held only for the file round-trip.
 */
export class RunnerHostStore {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly workspace: WorkspaceKey,
  ) {}

  /** The records as they are in the file now (one lock-free read). */
  list(): RunnerHostRecord[] {
    const entry = this.registry.readStoredEntry(this.workspace);
    if (!entry) throw new WorkspaceEntryGoneError(this.workspace.name, this.registry.filePath);
    return runnerHostRecordsOf(entry.runnerHosts);
  }

  add(input: AddRunnerHostInput): RunnerHostRecord {
    const url = normalizeHostUrl(input.url);
    const token = normalizeMasterToken(input.token);
    const label = input.label === undefined ? undefined : normalizeLabel(input.label);
    const record: RunnerHostRecord = {
      id: randomUUID(),
      url,
      ...(label !== undefined ? { label } : {}),
      tokenCiphertext: encrypt(token),
      tokenLast4: tokenLast4(token),
      binding: null,
    };
    return this.write((hosts) => {
      this.assertNoDuplicate(hosts, url);
      hosts.push(record);
      return copy(record);
    });
  }

  /**
   * Change url / label / token of one record. A new url keeps the binding (a
   * moved host connects on); a new token clears it (the next successful attempt
   * binds anew, `fo9bukuw`).
   */
  update(id: string, input: UpdateRunnerHostInput): RunnerHostRecord {
    const url = input.url === undefined ? undefined : normalizeHostUrl(input.url);
    const token = input.token === undefined ? undefined : normalizeMasterToken(input.token);
    const tokenCiphertext = token === undefined ? undefined : encrypt(token);
    return this.write((hosts) => {
      const record = this.find(hosts, id);
      if (url !== undefined) {
        this.assertNoDuplicate(hosts, url, id);
        record.url = url;
      }
      if (input.label !== undefined) {
        const label = normalizeLabel(input.label);
        if (label === undefined) delete record.label;
        else record.label = label;
      }
      if (token !== undefined && tokenCiphertext !== undefined) {
        record.tokenCiphertext = tokenCiphertext;
        record.tokenLast4 = tokenLast4(token);
        record.binding = null;
      }
      return copy(record);
    });
  }

  /** Remove one record together with its stored token. */
  remove(id: string): void {
    this.write((hosts) => {
      const index = hosts.findIndex((h) => isRecord(h) && h.id === id);
      if (index === -1) throw this.notFound(id);
      hosts.splice(index, 1);
    });
  }

  /**
   * Store the binding of one record. A record that is no longer in the file
   * (removed by another process) is NOT inserted back: the answer is `null`.
   */
  updateBinding(id: string, binding: RunnerHostBinding): RunnerHostRecord | null {
    return this.write((hosts) => {
      const record = hosts.find((h): h is RunnerHostRecord => isRecord(h) && h.id === id);
      if (!record) return null;
      record.binding = { ...binding };
      return copy(record);
    });
  }

  /**
   * One record operation on the freshly read entry, under the registry lock.
   * `hosts` is the entry's own array: records and fields this process does not
   * know stay as they were read.
   */
  private write<T>(operation: (hosts: unknown[]) => T): T {
    return this.registry.updateEntry(this.workspace, (entry: StoredWorkspaceRecord) => {
      if (!Array.isArray(entry.runnerHosts)) entry.runnerHosts = [];
      return operation(entry.runnerHosts);
    });
  }

  private find(hosts: unknown[], id: string): RunnerHostRecord {
    const record = hosts.find((h): h is RunnerHostRecord => isRecord(h) && h.id === id);
    if (!record) throw this.notFound(id);
    return record;
  }

  private assertNoDuplicate(hosts: unknown[], url: string, exceptId?: string): void {
    if (hosts.some((h) => isRecord(h) && h.id !== exceptId && sameUrl(h.url, url))) {
      throw new RunnerHostError('RUNNER_HOST_DUPLICATE', `a runner host with url ${url} already exists`, 'url');
    }
  }

  private notFound(id: string): RunnerHostError {
    return new RunnerHostError('NOT_FOUND', `runner host "${id}" not found`);
  }
}
