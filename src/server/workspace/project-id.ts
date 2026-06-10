import { createHash } from 'node:crypto';

/**
 * M31: stable project identity — sha1 of the absolute cwd, first 12 hex chars.
 * Same derivation the client reads from `window.__C4S_PROJECT__.id` (brief
 * 0.1.40→0.1.41 c4sproj01), now also the URL segment in `/api/projects/:id`
 * and the DB slot directory name under `~/.claude4spec/<workspace>/<id>/`.
 */
export function projectIdForCwd(cwd: string): string {
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}
