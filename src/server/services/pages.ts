import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { PageContent, PageNode, PageWriteInput, PageSearchHit } from '../../shared/types.js';

export class PagesService {
  readonly root: string;

  constructor(cwd: string, pagesDir: string = 'pages') {
    this.root = path.join(cwd, pagesDir);
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  async listTree(): Promise<PageNode[]> {
    await this.ensureRoot();
    return await this.walk(this.root, '');
  }

  async listMarkdownFiles(): Promise<string[]> {
    await this.ensureRoot();
    return this.collectMd(this.root, '');
  }

  async read(relPath: string): Promise<PageContent> {
    const abs = this.resolveSafe(relPath);
    const raw = await fs.readFile(abs, 'utf-8');
    const parsed = matter(raw);
    return {
      path: relPath,
      frontmatter: (parsed.data ?? {}) as Record<string, unknown>,
      body: parsed.content,
    };
  }

  async write(relPath: string, input: PageWriteInput): Promise<PageContent> {
    const abs = this.resolveSafe(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const hasFrontmatter = input.frontmatter && Object.keys(input.frontmatter).length > 0;
    const serialized = hasFrontmatter
      ? matter.stringify(input.body, input.frontmatter as Record<string, unknown>)
      : input.body;
    await fs.writeFile(abs, serialized, 'utf-8');
    return {
      path: relPath,
      frontmatter: input.frontmatter ?? {},
      body: input.body,
    };
  }

  async remove(relPath: string): Promise<void> {
    const abs = this.resolveSafe(relPath);
    await fs.unlink(abs);
  }

  async search(query: string, limit = 50): Promise<PageSearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    const files = await this.listMarkdownFiles();
    const hits: PageSearchHit[] = [];
    for (const rel of files) {
      if (hits.length >= limit) break;
      const pathHit = rel.toLowerCase().includes(lower);
      const abs = this.resolveSafe(rel);
      let snippet: string | null = null;
      let line = 0;
      try {
        const raw = await fs.readFile(abs, 'utf-8');
        const lines = raw.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const text = lines[i] ?? '';
          if (text.toLowerCase().includes(lower)) {
            snippet = text.trim().slice(0, 160);
            line = i + 1;
            break;
          }
        }
      } catch {
        /* ignore unreadable file */
      }
      if (pathHit || snippet) {
        hits.push({
          path: rel,
          line,
          snippet: snippet ?? '',
          matchesPath: pathHit,
        });
      }
    }
    return hits;
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      const abs = this.resolveSafe(relPath);
      await fs.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  private resolveSafe(relPath: string): string {
    if (!relPath || relPath.includes('\0')) throw new Error('invalid path');
    if (!relPath.endsWith('.md')) throw new Error('only .md paths allowed');
    const abs = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`path escapes pages root: ${relPath}`);
    }
    return abs;
  }

  private async collectMd(dir: string, prefix: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.push(...(await this.collectMd(path.join(dir, entry.name), rel)));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(rel);
      }
    }
    return out;
  }

  private async walk(dir: string, relPrefix: string): Promise<PageNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nodes: PageNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const children = await this.walk(path.join(dir, entry.name), rel);
        nodes.push({ type: 'folder', name: entry.name, path: rel, children });
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        nodes.push({ type: 'file', name: entry.name, path: rel });
      }
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }
}
