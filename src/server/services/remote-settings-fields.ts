import type { FieldDeclaration } from '../settings/field-registry.js';

/**
 * 0.2.113 — the two remote identifiers.
 *
 * `remoteProjectId` belongs to release push: set by the first successful push,
 * cleared by Disconnect (`PATCH { remoteProjectId: null }` ⇒ the next push founds a
 * new remote project).
 *
 * `remoteApiUrl` belongs to the remote account (M24 dev/staging override). Whether it
 * may be written through the API is an OPEN decision in the spec; until it is taken,
 * it keeps its pre-0.2.113 status — hand-edited only.
 */
export const REMOTE_SETTINGS_FIELDS: FieldDeclaration[] = [
  {
    key: 'remoteProjectId',
    owner: 'release-push',
    type: 'string|null',
    default: null,
    effect: 'per-operation',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'remoteApiUrl',
    owner: 'remote-account',
    type: 'string|null',
    default: null,
    // A parsable `http:`/`https:` URL; reachability is not checked.
    validate: (value) => {
      if (value === null || value === '') return { ok: true };
      try {
        const u = new URL(value as string);
        if (u.protocol === 'http:' || u.protocol === 'https:') return { ok: true };
      } catch {
        /* fall through */
      }
      return { ok: false, error: 'remoteApiUrl must be an http: or https: URL' };
    },
    effect: 'context-rebuild',
    resumeLock: false,
    apiWritable: false,
  },
];
