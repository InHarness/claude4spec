/**
 * M24 — the single abstraction over `fetch` to the remote claude4spec-API.
 * Owned by M24, consumed by future M25; no other module talks to the remote
 * directly. Base URL = `config.remoteApiUrl ?? PROD_REMOTE_URL` (the override is
 * dev/staging only — it is never persisted to `remote_session`, never logged,
 * and is not a secret). The Bearer is injected into owner-only calls only;
 * `/v1/auth/device/*` are unauthenticated.
 *
 * The remote wire contracts mirrored below are the claude4spec-api M02/M03 DTOs
 * (`@c4s/types`), duplicated here as local interfaces because the two repos do
 * not share a package.
 */

/** Hardcoded production remote. `config.remoteApiUrl` overrides for dev/staging. */
export const PROD_REMOTE_URL = 'https://claude4spec.inharness.ai';

// --- remote wire contracts (claude4spec-api M02/M03) -----------------------

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  token_id: string;
  account_id: string;
  issued_at: string;
}

export type DeviceTokenError =
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'access_denied'
  | 'invalid_grant';

export interface DeviceTokenErrorResponse {
  error: DeviceTokenError;
  error_description?: string;
}

export type AccountStatus = 'active' | 'deactivated';

export interface AccountProfileResponse {
  id: string;
  email: string;
  status: AccountStatus;
}

/** Result of the polling exchange: a one-time success or a polling-state error. */
export type DeviceTokenResult =
  | { ok: true; token: DeviceTokenResponse }
  | { ok: false; error: DeviceTokenError; description?: string };

/**
 * Thrown when an owner-only remote call returns 401 — the caller must clear the
 * local `remote_session` and force a fresh device flow.
 */
export class RemoteUnauthorizedError extends Error {
  constructor(message = 'remote session expired') {
    super(message);
    this.name = 'RemoteUnauthorizedError';
  }
}

/** Thrown for transport-level failures (connection refused / 5xx / unexpected shape). */
export class RemoteRequestError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'RemoteRequestError';
  }
}

export class RemoteHttpClient {
  private readonly baseUrl: string;

  constructor(remoteApiUrl: string | null | undefined) {
    this.baseUrl = (remoteApiUrl ?? PROD_REMOTE_URL).replace(/\/+$/, '');
  }

  get base(): string {
    return this.baseUrl;
  }

  /** POST /v1/auth/device/code — unauthenticated. Initiates the device flow. */
  async startDeviceFlow(): Promise<DeviceCodeResponse> {
    const res = await this.fetchRemote('/v1/auth/device/code', { method: 'POST' });
    if (!res.ok) throw new RemoteRequestError(`device/code failed (HTTP ${res.status})`, res.status);
    return (await res.json()) as DeviceCodeResponse;
  }

  /**
   * POST /v1/auth/device/token — unauthenticated, authorized by the device_code
   * itself. 200 → token (issued once); 400 → polling-state envelope
   * (authorization_pending / slow_down / terminal).
   */
  async pollDeviceToken(deviceCode: string): Promise<DeviceTokenResult> {
    const res = await this.fetchRemote('/v1/auth/device/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    });
    if (res.ok) {
      return { ok: true, token: (await res.json()) as DeviceTokenResponse };
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as DeviceTokenErrorResponse | null;
      if (body?.error) return { ok: false, error: body.error, description: body.error_description };
    }
    throw new RemoteRequestError(`device/token failed (HTTP ${res.status})`, res.status);
  }

  /** GET /v1/account — owner-only (Bearer). 401 → RemoteUnauthorizedError. */
  async getAccount(accessToken: string): Promise<AccountProfileResponse> {
    const res = await this.fetchRemote('/v1/account', {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) throw new RemoteUnauthorizedError();
    if (!res.ok) throw new RemoteRequestError(`GET /v1/account failed (HTTP ${res.status})`, res.status);
    return (await res.json()) as AccountProfileResponse;
  }

  private async fetchRemote(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new RemoteRequestError(`request to remote ${path} failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Startup reachability check for an explicit `config.remoteApiUrl` override.
 * "Reachable" = the host answers at all (any HTTP status); only a transport
 * failure / timeout counts as unreachable. No fallback to PROD_REMOTE_URL — an
 * explicit override must be honoured or reported (brief §1). Throws with the
 * exact contract message.
 */
export async function assertRemoteApiReachable(remoteApiUrl: string, timeoutMs = 3000): Promise<void> {
  const base = remoteApiUrl.replace(/\/+$/, '');
  try {
    await fetch(`${base}/v1/health`, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error(`config.json: field 'remoteApiUrl': invalid URL or unreachable host`);
  }
}
