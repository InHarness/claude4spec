/**
 * M24 Remote Account — DTOs exposed by `/api/remote-account/*` to the c4s
 * client. These are M24's OWN surface, intentionally decoupled from the
 * remote-API wire format (claude4spec-api `@c4s/types`). The backend
 * (`remote-auth.ts`) maps the remote's device-flow contract onto these shapes.
 */

/**
 * `POST /api/remote-account/login/start` — device flow initiated. The raw
 * `device_code` is NOT exposed: the backend keeps it in memory (single flow per
 * c4s instance) and supplies it itself when polling, so the secret never lands
 * in the browser.
 */
export interface DeviceLoginStartResponse {
  /** Short human-readable code (format `XXXX-XXXX`) typed on the verification page. */
  user_code: string;
  /** Verification page URL without the code (fallback). */
  verification_uri: string;
  /** Verification URL with the code prefilled — primary CTA (qr-code-ready). */
  verification_uri_complete: string;
  /** Seconds between polls; the client increases it when the remote says `slow_down`. */
  interval: number;
  /** Flow TTL in seconds; once exceeded the flow goes terminal `expired`. */
  expires_in: number;
}

/**
 * Status surfaced by `POST /api/remote-account/login/poll`. Non-terminal:
 * `pending` / `slow_down` (keep polling). Terminal: `authorized` (session
 * saved) and `expired` / `denied` / `invalid` (stop). Mapped from the remote
 * device-token enum (`authorization_pending | slow_down | expired_token |
 * access_denied | invalid_grant`).
 */
export type DeviceLoginStatus =
  | 'pending'
  | 'slow_down'
  | 'authorized'
  | 'expired'
  | 'denied'
  | 'invalid';

export interface DeviceLoginPollResponse {
  status: DeviceLoginStatus;
  /** Only for `slow_down` — new recommended interval (seconds). */
  interval?: number;
  /** User-facing message for terminal errors. */
  message?: string;
  /** Only for `authorized` — lets the UI jump straight to "connected as X" without a follow-up GET. */
  account?: RemoteAccountResponse;
}

/**
 * `GET /api/remote-account` — the sidebar's identity source. NEVER exposes
 * `access_token`. Stable contract consumed by the sidebar (TanStack Query key
 * `["remote-account"]`) and, later, by M25 publish.
 */
export interface RemoteAccountResponse {
  /** `true` when a `remote_session` row exists. */
  connected: boolean;
  /** UUID of the remote account (`remote_session.remote_account_id`). */
  remoteAccountId?: string;
  /** UI label — the only "connected as X" identity the remote exposes. */
  accountEmail?: string;
  /** `deactivated` blocks publish (M25). */
  accountStatus?: 'active' | 'deactivated';
  /** ISO 8601 from `remote_session.connected_at`. */
  connectedAt?: string;
}
