/**
 * M24 — the single abstraction over `fetch` to the remote claude4spec-API.
 * Owned by M24; no other module talks to the remote directly. Base URL = the
 * effective address (`effectiveRemoteUrl`): the `--remote-url` start flag >
 * `config.remoteApiUrl` > `PROD_REMOTE_URL`. The address is not a secret; a
 * login records it in `remote_session.issuer_url` (2.1.58, `ux690pt2`). The
 * Bearer is injected into owner-only calls only; `/v1/auth/device/*` are
 * unauthenticated.
 *
 * The remote wire contracts mirrored below are the claude4spec-api M02/M03 DTOs
 * (`@c4s/types`), duplicated here as local interfaces because the two repos do
 * not share a package.
 */

/**
 * Hardcoded production remote — the last step of the effective address
 * (`effectiveRemoteUrl`): the `--remote-url` start flag and then
 * `config.remoteApiUrl` override it for dev/staging.
 */
export const PROD_REMOTE_URL = 'https://claude4spec.inharness.ai';

/**
 * 2.1.58 (M24 `ux690pt2`): the effective remote address of a project context —
 * the `--remote-url` start flag (process lifetime, every project of the
 * workspace, never written anywhere) > `config.remoteApiUrl` > the production
 * constant. An empty value is no override. The result is the address as
 * configured — trimmed, the path's trailing slashes dropped, everything else
 * (the query included, character for character) kept — because it is the base
 * every request is sent to. Comparing two addresses as the same issuer is
 * `remoteAddressIdentity`'s job, done once by the session service, never here.
 */
export function effectiveRemoteUrl(flag: string | undefined, configured: string | null | undefined): string {
  const chosen = [flag, configured].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  const trimmed = (chosen ?? PROD_REMOTE_URL).trim();
  // Only the part before the query/fragment is the path; the rest stays as is.
  const cut = trimmed.search(/[?#]/);
  const head = cut === -1 ? trimmed : trimmed.slice(0, cut);
  const tail = cut === -1 ? '' : trimmed.slice(cut);
  return `${head.replace(/\/+$/, '')}${tail}`;
}

/**
 * The identity form of a remote address: the URL's origin (scheme and host
 * lower-cased, a default port dropped) followed by its path without trailing
 * slashes. Two spellings of the same remote — `https://Remote.example:443/` and
 * `https://remote.example` — give the same string. Both inputs are validated as
 * http(s) URLs at start (`isRemoteApiUrl`); a value `URL` cannot parse is only
 * trimmed and stripped of trailing slashes. Used only for the session's
 * `issuer_url` (write and compare), never as a request target.
 */
export function remoteAddressIdentity(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

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
  /** `baseUrl` parsed once; null when `URL` cannot parse it (requests then concatenate). */
  private readonly parsedBase: URL | null;

  /** `baseUrl` is the effective address (`effectiveRemoteUrl`). */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    let parsed: URL | null = null;
    try {
      parsed = new URL(baseUrl);
    } catch {
      parsed = null;
    }
    this.parsedBase = parsed;
  }

  /** The effective remote address this context talks to, as configured (its `remoteAddressIdentity` is the issuer a login records). */
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

  /**
   * The request target for `path` under the base: the path is appended to the
   * base's own path, and the base's query stays as configured.
   */
  private urlFor(path: string): string {
    if (!this.parsedBase) return `${this.baseUrl}${path}`;
    const url = new URL(this.parsedBase.href);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
    return url.href;
  }

  private async fetchRemote(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(this.urlFor(path), init);
    } catch (err) {
      throw new RemoteRequestError(`request to remote ${path} failed: ${(err as Error).message}`);
    }
  }
}
