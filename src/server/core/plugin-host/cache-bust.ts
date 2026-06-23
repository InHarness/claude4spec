/**
 * M33 phase 3 — shared dynamic-import cache-bust suffix.
 *
 * Node caches ESM modules per-URL, so re-importing the same `file://` href after
 * an edit returns the STALE module. A `?v=<contentHash>` query yields a fresh URL
 * exactly when the bytes change (and the cached one when they don't) — making a
 * post-invalidation rebuild pick up edited plugin code without a restart. Used by
 * both the workspace loader (base) and the project-local overlay loader.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

export function entryCacheBust(entry: string): string {
  try {
    const hash = crypto.createHash('sha1').update(fs.readFileSync(entry)).digest('hex').slice(0, 12);
    return `?v=${hash}`;
  } catch {
    return '';
  }
}
