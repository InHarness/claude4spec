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

import { createReadStream } from 'node:fs';

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

/** Release meta echoed by both push endpoints (claude4spec-api M02/M03). */
export interface RemoteReleaseMeta {
  id: string;
  projectId: string;
  sequence: number;
  contentSha256: string;
  contentSizeBytes: number;
  createdAt: string;
  pushedBy: { accountId: string; tokenId: string | null };
}

/** `POST /v1/projects` (first push) — creates a project and its first release. */
export interface CreateProjectResponse {
  project: { id: string; slug: string; name: string; description: string | null; createdAt: string };
  release: RemoteReleaseMeta;
}

/** `POST /v1/projects/:id/releases` (subsequent push). 201 fresh / 200 dedup. */
export interface PushReleaseResponse {
  release: RemoteReleaseMeta;
  deduplicated: boolean;
}

/** Bytes-derived inputs for a push, all sourced from M17.buildBundleArchive. */
export interface PushBundlePayload {
  tarGzPath: string;
  sizeBytes: number;
  sha256: string;
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

  /**
   * POST /v1/projects — first push. Streams the bundle as octet-stream and
   * creates a new remote project named `projectName`. 401 → RemoteUnauthorizedError;
   * any other non-2xx → RemoteRequestError (message from the remote error envelope).
   */
  async createProject(
    accessToken: string,
    payload: PushBundlePayload,
    projectName: string,
  ): Promise<CreateProjectResponse> {
    const res = await this.streamBundle('/v1/projects', accessToken, payload, {
      'x-project-name': projectName,
    });
    if (res.status === 401) throw new RemoteUnauthorizedError();
    if (!res.ok) {
      throw new RemoteRequestError(await this.errorMessageFrom(res, `POST /v1/projects failed (HTTP ${res.status})`), res.status);
    }
    return (await res.json()) as CreateProjectResponse;
  }

  /**
   * POST /v1/projects/:remoteProjectId/releases — subsequent push (no
   * X-Project-Name). 200 = deduplicated hit, 201 = fresh release; both carry the
   * `deduplicated` flag. 401 → RemoteUnauthorizedError; other non-2xx → RemoteRequestError.
   */
  async pushRelease(
    accessToken: string,
    remoteProjectId: string,
    payload: PushBundlePayload,
  ): Promise<PushReleaseResponse> {
    const res = await this.streamBundle(
      `/v1/projects/${encodeURIComponent(remoteProjectId)}/releases`,
      accessToken,
      payload,
    );
    if (res.status === 401) throw new RemoteUnauthorizedError();
    if (!res.ok) {
      throw new RemoteRequestError(await this.errorMessageFrom(res, `POST /v1/projects/:id/releases failed (HTTP ${res.status})`), res.status);
    }
    return (await res.json()) as PushReleaseResponse;
  }

  /** Streams `tarGzPath` as application/octet-stream with the integrity + auth headers. */
  private streamBundle(
    path: string,
    accessToken: string,
    payload: PushBundlePayload,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'content-length': String(payload.sizeBytes),
      'x-content-sha256': payload.sha256,
      authorization: `Bearer ${accessToken}`,
      ...extraHeaders,
    };
    // `duplex: 'half'` is required by undici when the body is a stream; it is not
    // yet in the DOM RequestInit type, hence the cast.
    return this.fetchRemote(path, {
      method: 'POST',
      headers,
      body: createReadStream(payload.tarGzPath) as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit);
  }

  /** Best-effort human message from a remote error response (`{error:{message|code}}` or NestJS `{message}`). */
  private async errorMessageFrom(res: Response, fallback: string): Promise<string> {
    try {
      const body = (await res.json()) as
        | { error?: { code?: string; message?: string }; message?: string }
        | null;
      if (body?.error?.message) return body.error.message;
      if (body?.error?.code) return body.error.code;
      if (typeof body?.message === 'string') return body.message;
    } catch {
      /* non-JSON body — fall through */
    }
    return fallback;
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
