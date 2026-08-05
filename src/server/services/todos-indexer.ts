import { parseXmlTagsExcludingCode } from '../../shared/xml-tags.js';
import type { TodoHit } from '../../shared/types.js';
import type { PagesService } from './pages.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { WatchSubscriber, WatchScope } from '../fs/watcher.js';
import { requireRootId } from '../fs/sources.js';

/**
 * 0.1.96: indexes `<todo/>` tags across every root that has a sidebar tree.
 * Keyed by `${rootId}:${relPath}`; `TodoHit`/`countByPath` carry the rootId so
 * the sidebar can attribute indicators to the right root.
 *
 * 0.2.10 (M40): the whole substance of this module is its reaction to a file
 * change, so it implements the subscriber contract directly — `onChange` /
 * `onUnlink`, nothing more. It merges events from every `pages:<rootId>` source
 * and derives `rootId` from the source-name suffix. It is read-only and never
 * calls `suppress()`. Debounce is gone: it belongs to the mount now.
 */
export class TodosIndexerService implements WatchSubscriber {
  private byKey = new Map<string, TodoHit[]>();

  constructor(private roots: Map<string, PagesService>, private ws: WsEmitter) {}

  private key(rootId: string, relPath: string): string {
    return `${rootId}:${relPath}`;
  }

  async onChange(_scope: WatchScope, source: string, relPath: string): Promise<void> {
    await this.indexPage(requireRootId(source), relPath);
  }

  onUnlink(_scope: WatchScope, source: string, relPath: string): void {
    const rootId = requireRootId(source);
    if (this.byKey.delete(this.key(rootId, relPath))) {
      this.ws.broadcast({ kind: 'todos:changed', rootId, pagePath: relPath });
    }
  }

  async indexAll(): Promise<void> {
    let fileCount = 0;
    for (const [rootId, svc] of this.roots) {
      const files = await svc.listMarkdownFiles();
      for (const rel of files) {
        await this.indexPage(rootId, rel, { silent: true });
        fileCount++;
      }
    }
    const total = this.countTotal();
    console.log(`[todos-indexer] indexed ${fileCount} files, ${total} todos`);
  }

  async indexPage(rootId: string, relPath: string, opts: { silent?: boolean } = {}): Promise<void> {
    const svc = this.roots.get(rootId);
    const k = this.key(rootId, relPath);
    if (!svc) return;
    let page;
    try {
      page = await svc.read(relPath);
    } catch {
      if (this.byKey.delete(k) && !opts.silent) {
        this.ws.broadcast({ kind: 'todos:changed', rootId, pagePath: relPath });
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
        rootId,
        pagePath: relPath,
        line: t.line,
        col,
        comment: t.attrs.comment ?? '',
        anchor,
      });
    }

    const prev = this.byKey.get(k);
    const changed = !sameHits(prev, hits);
    if (hits.length === 0) {
      this.byKey.delete(k);
    } else {
      this.byKey.set(k, hits);
    }
    if (changed && !opts.silent) {
      this.ws.broadcast({ kind: 'todos:changed', rootId, pagePath: relPath });
    }
  }

  listAll(): TodoHit[] {
    const out: TodoHit[] = [];
    const keys = [...this.byKey.keys()].sort();
    for (const k of keys) {
      const hits = this.byKey.get(k);
      if (hits) out.push(...hits);
    }
    return out;
  }

  listByPath(rootId: string, relPath: string): TodoHit[] {
    return this.byKey.get(this.key(rootId, relPath)) ?? [];
  }

  /** Counts keyed by `${rootId}:${relPath}`. */
  countByPath(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.byKey) out[k] = v.length;
    return out;
  }

  countTotal(): number {
    let total = 0;
    for (const v of this.byKey.values()) total += v.length;
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
