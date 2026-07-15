/**
 * Shared path helpers for M36 chat artifacts (briefs/patches) — was duplicated
 * verbatim across briefs-api.ts/patches-api.ts (path encoding) and
 * patches-api.ts/BriefsList.tsx (filename stem).
 */

/** Splat-safe path encoding — preserves `/` separators, escapes special chars per segment. */
export function encodeArtifactPath(relPath: string): string {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

/** Filename without directory or `.md` extension. */
export function stem(relPath: string): string {
  return relPath.replace(/^.*\//, '').replace(/\.md$/i, '');
}
