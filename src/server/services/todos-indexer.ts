import { parseXmlTagsExcludingCode } from '../../shared/xml-tags.js';
import type { TodoHit } from '../../shared/types.js';
import type { PagesService } from './pages.js';
import type { WsEmitter } from '../ws/project-emitter.js';

export class TodosIndexerService {
  private debounceMs = 300;
  private pending = new Map<string, NodeJS.Timeout>();
  private byPath = new Map<string, TodoHit[]>();

  constructor(private pages: PagesService, private ws: WsEmitter) {}

  schedulePage(relPath: string): void {
    const prev = this.pending.get(relPath);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.pending.delete(relPath);
      this.indexPage(relPath).catch((err) => {
        console.error(`[todos-indexer] failed to index ${relPath}:`, err);
      });
    }, this.debounceMs);
    this.pending.set(relPath, timer);
  }

  handleUnlink(relPath: string): void {
    const prev = this.pending.get(relPath);
    if (prev) {
      clearTimeout(prev);
      this.pending.delete(relPath);
    }
    if (this.byPath.delete(relPath)) {
      this.ws.broadcast({ kind: 'todos:changed', pagePath: relPath });
    }
  }

  async indexAll(): Promise<void> {
    const files = await this.pages.listMarkdownFiles();
    for (const rel of files) {
      await this.indexPage(rel, { silent: true });
    }
    const total = this.countTotal();
    console.log(`[todos-indexer] indexed ${files.length} files, ${total} todos`);
  }

  async indexPage(relPath: string, opts: { silent?: boolean } = {}): Promise<void> {
    let page;
    try {
      page = await this.pages.read(relPath);
    } catch {
      if (this.byPath.delete(relPath) && !opts.silent) {
        this.ws.broadcast({ kind: 'todos:changed', pagePath: relPath });
      }
      return;
    }
    const body = page.body;
    const tags = parseXmlTagsExcludingCode(body).filter((t) => t.kind === 'todo');

    const hits: TodoHit[] = [];
    const seenAnchors = new Set<string>();
    for (const t of tags) {
      const lineStartOffset = body.lastIndexOf('\n', t.start - 1) + 1;
      const col = t.start - lineStartOffset;
      let anchor = `todo-${t.line}`;
      if (seenAnchors.has(anchor)) anchor = `todo-${t.line}-${col}`;
      seenAnchors.add(anchor);
      hits.push({
        pagePath: relPath,
        line: t.line,
        col,
        comment: t.attrs.comment ?? '',
        anchor,
      });
    }

    const prev = this.byPath.get(relPath);
    const changed = !sameHits(prev, hits);
    if (hits.length === 0) {
      this.byPath.delete(relPath);
    } else {
      this.byPath.set(relPath, hits);
    }
    if (changed && !opts.silent) {
      this.ws.broadcast({ kind: 'todos:changed', pagePath: relPath });
    }
  }

  listAll(): TodoHit[] {
    const out: TodoHit[] = [];
    const keys = [...this.byPath.keys()].sort();
    for (const k of keys) {
      const hits = this.byPath.get(k);
      if (hits) out.push(...hits);
    }
    return out;
  }

  listByPath(relPath: string): TodoHit[] {
    return this.byPath.get(relPath) ?? [];
  }

  countByPath(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.byPath) out[k] = v.length;
    return out;
  }

  countTotal(): number {
    let total = 0;
    for (const v of this.byPath.values()) total += v.length;
    return total;
  }
}

function sameHits(a: TodoHit[] | undefined, b: TodoHit[]): boolean {
  if (!a) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.line !== y.line || x.col !== y.col || x.comment !== y.comment) return false;
  }
  return true;
}

