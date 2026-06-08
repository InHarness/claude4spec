import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * M30 (L2): static file server rooted at `pagesDir`, backing `GET /api/static/*`.
 *
 * Used as the iframe `src` for the read-only HTML preview. Deliberately a separate
 * slice from `PagesService`: it copies the `resolveSafe` *pattern* from `pages.ts`
 * rather than sharing a helper, and applies NO extension whitelist (any file under
 * `pagesDir` is servable so relative assets — `./style.css`, `img/x.png` — resolve).
 */

/** Thrown when a requested path escapes `pagesDir` (`../`, absolute, null byte). Maps to HTTP 403. */
export class StaticPathTraversalError extends Error {
  constructor(relPath: string) {
    super(`path escapes pages root: ${relPath}`);
    this.name = 'StaticPathTraversalError';
  }
}

export class StaticHtmlService {
  readonly root: string;

  constructor(cwd: string, pagesDir: string = 'pages') {
    this.root = path.join(cwd, pagesDir);
  }

  /**
   * Resolve a request path (relative to `pagesDir`) to an absolute path, guarding
   * against traversal. No extension check. Throws {@link StaticPathTraversalError}
   * if the path would escape the root.
   */
  resolveSafe(relPath: string): string {
    if (!relPath || relPath.includes('\0')) throw new StaticPathTraversalError(relPath);
    const abs = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new StaticPathTraversalError(relPath);
    }
    return abs;
  }

  /** True if the resolved (in-root) path exists and is a regular file. */
  async existsFile(abs: string): Promise<boolean> {
    try {
      const stat = await fs.stat(abs);
      return stat.isFile();
    } catch {
      return false;
    }
  }
}
