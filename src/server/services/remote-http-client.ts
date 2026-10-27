/**
 * M24 — the single abstraction over `fetch` to the remote claude4spec-API.
 * Owned by M24; no other module talks to the remote directly. Base URL = `config.remoteApiUrl ?? PROD_REMOTE_URL` (the override is
 * dev/staging only — it is never persisted to `remote_session`, never logged,
 * and is not a secret). The Bearer is injected into owner-only calls only;
 * `/v1/auth/device/*` are unauthenticated.
 *
 * The remote wire contracts mirrored below are the claude4spec-api M02/M03 DTOs
 * (`@c4s/types`), duplicated here as local interfaces because the two repos do
 * not share a package.
 */

import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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

/**
 * `GET /v1/projects/{slug}` (M27 clone) — public anonymous project meta. Draft /
 * missing / renamed slugs are a hard 404 from the peer. The CLI clone reads
 * `status` (must be `'published'`) and `id` (stable key; the slug is mutable).
 */
export interface ProjectMetaResponse {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string; // 'draft' | 'published'
  createdAt: string;
}

/**
 * Headers captured while streaming `GET /v1/projects/{slug}/snapshot` to disk.
 * The bundle bytes are written to `tarGzPath`; the SHA is verified by the caller
 * (M27 §1 step 4) against `contentSha256`. Any header may be absent (→ null).
 */
export interface SnapshotDownloadResult {
  contentSha256: string | null;
  contentLength: number | null;
  releaseId: string | null;
  releaseSequence: number | null;
  projectId: string | null;
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

  /**
   * GET /v1/projects/{slug} — public, anonymous (NO Bearer). M27 clone pre-flight.
   * Draft / missing / renamed slug ⇒ 404 (surfaced as RemoteRequestError status
   * 404, mapped to REMOTE_PROJECT_NOT_FOUND by the clone service).
   */
  async getProjectBySlug(slug: string): Promise<ProjectMetaResponse> {
    const res = await this.fetchRemote(`/v1/projects/${encodeURIComponent(slug)}`, { method: 'GET' });
    if (!res.ok) {
      throw new RemoteRequestError(
        await this.errorMessageFrom(res, `GET /v1/projects/:slug failed (HTTP ${res.status})`),
        res.status,
      );
    }
    return (await res.json()) as ProjectMetaResponse;
  }

  /**
   * GET /v1/projects/{slug}/snapshot — public, anonymous (NO Bearer). Streams the
   * latest release's tar.gz to `destTarGzPath` and returns the integrity/identity
   * headers. 404 ⇒ RemoteRequestError(404) (missing/draft slug, or published
   * project with no releases). The caller verifies SHA-256 before restore.
   *
   * The peer serves `Content-Type: application/octet-stream` with no
   * `Content-Disposition`; the body is treated as a raw byte stream and piped
   * verbatim. Identity/integrity come ONLY from `X-Content-SHA256` and the
   * manifest's `bundleSchemaVersion` — never the MIME header. Adding a
   * Content-Type/Content-Disposition gate here would break clone against the live
   * peer (brief 0.1.37).
   */
  async downloadSnapshot(slug: string, destTarGzPath: string): Promise<SnapshotDownloadResult> {
    const res = await this.fetchRemote(`/v1/projects/${encodeURIComponent(slug)}/snapshot`, { method: 'GET' });
    if (!res.ok || !res.body) {
      throw new RemoteRequestError(
        await this.errorMessageFrom(res, `GET /v1/projects/:slug/snapshot failed (HTTP ${res.status})`),
        res.status,
      );
    }
    await pipeline(
      Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(destTarGzPath),
    );
    const h = (name: string): string | null => res.headers.get(name);
    const contentLength = h('content-length');
    const releaseSequence = h('x-release-sequence');
    return {
      contentSha256: h('x-content-sha256'),
      contentLength: contentLength != null ? Number(contentLength) : null,
      releaseId: h('x-release-id'),
      releaseSequence: releaseSequence != null ? Number(releaseSequence) : null,
      projectId: h('x-project-id'),
    };
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

  /** Best-effort human message from a remote error response (`{error:{message|code}}` or NestJS `{message}`). */
  private async errorMessageFrom(res: Response, fallback: string): Promise<string> {
    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      return fallback;
    }
    const body = raw as
      | { error?: { code?: string; message?: string }; message?: string | string[] }
      | null;
    if (body?.error?.message) return body.error.message;
    if (body?.error?.code) return body.error.code;
    if (Array.isArray(body?.message)) return body.message.join('; ');
    if (typeof body?.message === 'string') return body.message;
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
