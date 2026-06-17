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

import { createReadStream, createWriteStream } from 'node:fs';
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

/**
 * `GET /v1/projects/by-id/:uuid` (M26 §4, 0.1.32) — anon-tolerant snapshot of the
 * remote project. Anonymous and non-owner readers get the public subset
 * (`name`, `description`, `createdAt`); the owner additionally sees
 * `lastReleaseAt` and `owner`. `isOwner` is the discriminator surfaced by the
 * peer; locally we still defense-in-depth strip owner-only fields if they
 * appear with `isOwner: false`.
 */
export interface GetProjectResponse {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  isOwner: boolean;
  lastReleaseAt?: string;
  owner?: { email: string; name?: string };
}

/** Body of `PATCH /v1/projects/by-id/:uuid` (0.1.32) — owner-only edit. */
export interface UpdateProjectPayload {
  name?: string;
  description?: string | null;
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
  constructor(message: string, public status?: number, public details?: unknown) {
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
   * GET /v1/projects/by-id/:uuid — bearer OPTIONAL. M26 §4 surface; consumed by
   * `/api/remote-project`. Anonymous reader gets the public subset; the owner
   * gets the owner subset; non-owner gets the public subset. 401 → only happens
   * when a bearer WAS sent (token expired/revoked) — RemoteUnauthorizedError so
   * the M24 client can wipe the stale session. 404 distinguished via `status`
   * on RemoteRequestError so the route handler can map it to `reason: 'not_found'`.
   */
  async getProject(accessToken: string | null, remoteProjectId: string): Promise<GetProjectResponse> {
    const headers: Record<string, string> = {};
    if (accessToken !== null) headers.authorization = `Bearer ${accessToken}`;
    const res = await this.fetchRemote(`/v1/projects/by-id/${encodeURIComponent(remoteProjectId)}`, {
      method: 'GET',
      headers,
    });
    if (res.status === 401) throw new RemoteUnauthorizedError();
    if (!res.ok) {
      throw new RemoteRequestError(
        await this.errorMessageFrom(res, `GET /v1/projects/by-id/:uuid failed (HTTP ${res.status})`),
        res.status,
      );
    }
    return (await res.json()) as GetProjectResponse;
  }

  /**
   * PATCH /v1/projects/by-id/:uuid — owner-only (Bearer required). 0.1.32 M25 §1a.
   * On 422 the peer's NestJS class-validator body is preserved on the thrown
   * RemoteRequestError.details so the local route can extract the offending
   * `property` for inline form error surfacing. 401 → RemoteUnauthorizedError
   * (session wipe). 403 → owner mismatch race (status preserved).
   */
  async updateProject(
    accessToken: string,
    remoteProjectId: string,
    body: UpdateProjectPayload,
  ): Promise<GetProjectResponse> {
    const res = await this.fetchRemote(`/v1/projects/by-id/${encodeURIComponent(remoteProjectId)}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new RemoteUnauthorizedError();
    if (!res.ok) {
      const { message, details } = await this.errorEnvelopeFrom(
        res,
        `PATCH /v1/projects/by-id/:uuid failed (HTTP ${res.status})`,
      );
      throw new RemoteRequestError(message, res.status, details);
    }
    return (await res.json()) as GetProjectResponse;
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
    return (await this.errorEnvelopeFrom(res, fallback)).message;
  }

  /**
   * Best-effort human message + raw body for downstream parsing (e.g. extracting
   * the offending `property` from a NestJS class-validator 422 envelope).
   * Consumes the response body once; safe to swallow non-JSON.
   */
  private async errorEnvelopeFrom(
    res: Response,
    fallback: string,
  ): Promise<{ message: string; details: unknown }> {
    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      return { message: fallback, details: null };
    }
    const body = raw as
      | { error?: { code?: string; message?: string }; message?: string | string[] }
      | null;
    if (body?.error?.message) return { message: body.error.message, details: raw };
    if (body?.error?.code) return { message: body.error.code, details: raw };
    if (Array.isArray(body?.message)) return { message: body.message.join('; '), details: raw };
    if (typeof body?.message === 'string') return { message: body.message, details: raw };
    return { message: fallback, details: raw };
  }

  private async fetchRemote(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new RemoteRequestError(`request to remote ${path} failed: ${(err as Error).message}`);
    }
  }
}
