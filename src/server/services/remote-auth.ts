import type Database from 'better-sqlite3';
import { DomainError } from './tags.js';
import {
  RemoteHttpClient,
  RemoteRequestError,
  RemoteUnauthorizedError,
  type AccountProfileResponse,
  type DeviceTokenError,
  type DeviceTokenResponse,
  type GetProjectResponse,
} from './remote-http-client.js';
import type {
  DeviceLoginPollResponse,
  DeviceLoginStartResponse,
  DeviceLoginStatus,
  RemoteAccountResponse,
} from '../../shared/remote-account.js';

/** Input to `RemoteAuthService.pushBundle` — bytes-derived values come from M17. */
export interface PushBundleInput {
  tarGzPath: string;
  sizeBytes: number;
  sha256: string;
  /** Sent as `X-Project-Name` on first push (config.name). */
  projectName: string;
  /** `null` ⇒ first push (create project); a UUID ⇒ subsequent push. */
  remoteProjectId: string | null;
}

/** Unified outcome from a push, regardless of first vs subsequent endpoint. */
export interface PushBundleOutcome {
  remoteProjectId: string;
  remoteReleaseId: string;
  remoteReleaseSequence: number;
  deduplicated: boolean;
}

interface RemoteSessionRow {
  id: number;
  access_token: string;
  token_id: string;
  issued_at: string;
  remote_account_id: string;
  account_email: string;
  account_status: string;
  connected_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * In-memory device-flow state — single flow per c4s process. Lives only in
 * memory: the `device_code` is a secret the browser must never see, and a flow
 * is meaningless across restarts. Re-entry (login/start during an active flow)
 * overwrites this — the user may have closed and reopened the slot.
 */
interface FlowState {
  deviceCode: string;
  interval: number;
  expiresAt: number; // epoch ms — informational; the remote is the authority on expiry
}

/**
 * M24 — authenticates c4s against the remote API via OAuth Device Authorization
 * Grant. Login is a human action (no MCP tool): the agent never logs in or
 * touches the device flow. The token is an operational secret kept in
 * `remote_session` and never returned to the UI.
 */
export class RemoteAuthService {
  private flow: FlowState | null = null;

  constructor(
    private db: Database.Database,
    private client: RemoteHttpClient,
  ) {}

  /** POST /api/remote-account/login/start. */
  async startDeviceFlow(): Promise<DeviceLoginStartResponse> {
    const r = await this.client.startDeviceFlow();
    this.flow = {
      deviceCode: r.device_code,
      interval: r.interval,
      expiresAt: Date.now() + r.expires_in * 1000,
    };
    // device_code is intentionally NOT returned — the backend supplies it when polling.
    return {
      user_code: r.user_code,
      verification_uri: r.verification_uri,
      verification_uri_complete: r.verification_uri_complete,
      interval: r.interval,
      expires_in: r.expires_in,
    };
  }

  /** POST /api/remote-account/login/poll. */
  async pollDeviceFlow(): Promise<DeviceLoginPollResponse> {
    if (!this.flow) {
      throw new DomainError('NO_ACTIVE_FLOW', 'no active device flow; call login/start first');
    }
    const result = await this.client.pollDeviceToken(this.flow.deviceCode);
    if (result.ok) {
      const account = await this.persistSession(result.token);
      this.flow = null;
      return { status: 'authorized', account };
    }
    const status = mapPollStatus(result.error);
    if (status === 'slow_down') {
      this.flow.interval += 5; // RFC 8628: back off by a fixed step
      return { status, interval: this.flow.interval };
    }
    if (status !== 'pending') {
      this.flow = null; // terminal — drop the flow
      return { status, message: result.description };
    }
    return { status }; // pending — keep polling
  }

  /** GET /api/remote-account. Never exposes access_token. */
  getCurrentAccount(): RemoteAccountResponse {
    const row = this.readSession();
    return row ? toRemoteAccount(row) : { connected: false };
  }

  /** POST /api/remote-account/logout. Idempotent; also aborts an in-flight device flow. */
  logout(): RemoteAccountResponse {
    this.flow = null;
    this.db.prepare('DELETE FROM remote_session').run();
    return { connected: false };
  }

  /**
   * M26 §4 consumer entry point — fetch the remote project for the
   * `/api/remote-project` proxy. Single owner of Bearer injection + 401 wipe;
   * the route handler maps the discriminated result to the public DTO.
   *
   * Returns:
   *  - `{ kind: 'ok', project }` on 200.
   *  - `{ kind: 'not_found' }` on remote 404 (so the route surfaces `reason: 'not_found'`).
   *
   * Throws `DomainError('NOT_CONNECTED')` if there is no session; throws
   * `RemoteUnauthorizedError` after wiping the session on 401 (route maps to
   * 502 SESSION_EXPIRED); rethrows `RemoteRequestError` on other transport
   * errors / 5xx (route maps to 502 REMOTE_UNAVAILABLE).
   */
  async getRemoteProject(
    remoteProjectId: string,
  ): Promise<{ kind: 'ok'; project: GetProjectResponse } | { kind: 'not_found' }> {
    const row = this.readSession();
    if (!row) throw new DomainError('NOT_CONNECTED', 'not connected to the remote server');
    try {
      const project = await this.client.getProject(row.access_token, remoteProjectId);
      return { kind: 'ok', project };
    } catch (err) {
      if (err instanceof RemoteUnauthorizedError) {
        this.db.prepare('DELETE FROM remote_session').run();
        throw err;
      }
      if (err instanceof RemoteRequestError && err.status === 404) {
        return { kind: 'not_found' };
      }
      throw err;
    }
  }

  /**
   * M25 consumer entry point — transports a release bundle to the remote with the
   * Bearer injected from the local session. First push (`remoteProjectId === null`)
   * creates the project; subsequent pushes append a release. The access_token never
   * leaves M24. On 401 the single-row `remote_session` is atomically wiped (same as
   * logout) and the `RemoteUnauthorizedError` is re-thrown for M25 to map to 502.
   */
  async pushBundle(input: PushBundleInput): Promise<PushBundleOutcome> {
    const row = this.readSession();
    if (!row) throw new DomainError('NOT_CONNECTED', 'not connected to the remote server');
    const payload = { tarGzPath: input.tarGzPath, sizeBytes: input.sizeBytes, sha256: input.sha256 };
    try {
      if (input.remoteProjectId === null) {
        const res = await this.client.createProject(row.access_token, payload, input.projectName);
        return {
          remoteProjectId: res.project.id,
          remoteReleaseId: res.release.id,
          remoteReleaseSequence: res.release.sequence,
          deduplicated: false,
        };
      }
      const res = await this.client.pushRelease(row.access_token, input.remoteProjectId, payload);
      return {
        remoteProjectId: input.remoteProjectId,
        remoteReleaseId: res.release.id,
        remoteReleaseSequence: res.release.sequence,
        deduplicated: res.deduplicated,
      };
    } catch (err) {
      if (err instanceof RemoteUnauthorizedError) {
        this.db.prepare('DELETE FROM remote_session').run();
      }
      throw err;
    }
  }

  // --- internals ----------------------------------------------------------

  private readSession(): RemoteSessionRow | null {
    return (
      (this.db.prepare('SELECT * FROM remote_session LIMIT 1').get() as RemoteSessionRow | undefined) ?? null
    );
  }

  /**
   * Fetch the account profile (email/status), then atomically replace the
   * single `remote_session` row. Profile-first so a failed enrich never leaves
   * a half-written row; a 401 here means the freshly-issued token was already
   * rejected — surface as unauthenticated without persisting.
   */
  private async persistSession(token: DeviceTokenResponse): Promise<RemoteAccountResponse> {
    let profile: AccountProfileResponse;
    try {
      profile = await this.client.getAccount(token.access_token);
    } catch (err) {
      if (err instanceof RemoteUnauthorizedError) {
        throw new DomainError('REMOTE_UNAUTHORIZED', 'remote session expired; log in again');
      }
      throw err;
    }
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM remote_session').run();
      this.db
        .prepare(
          `INSERT INTO remote_session
             (access_token, token_id, issued_at, remote_account_id, account_email, account_status)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(token.access_token, token.token_id, token.issued_at, token.account_id, profile.email, profile.status);
    });
    tx();
    return this.getCurrentAccount();
  }
}

/** Maps the remote device-token enum onto M24's own poll-status enum. */
function mapPollStatus(error: DeviceTokenError): DeviceLoginStatus {
  switch (error) {
    case 'authorization_pending':
      return 'pending';
    case 'slow_down':
      return 'slow_down';
    case 'expired_token':
      return 'expired';
    case 'access_denied':
      return 'denied';
    case 'invalid_grant':
      return 'invalid';
  }
}

function toRemoteAccount(row: RemoteSessionRow): RemoteAccountResponse {
  return {
    connected: true,
    remoteAccountId: row.remote_account_id,
    accountEmail: row.account_email,
    accountStatus: row.account_status === 'deactivated' ? 'deactivated' : 'active',
    connectedAt: row.connected_at,
  };
}
