import { useEffect, useRef } from 'react';
import { PROJECT_ID, apiFetch, unwrap } from '../../../frontend-kit/api-core.js';
import { CODE_SNIPPET_TYPE } from '../../../identity.js';

/** One `code-snippet` record, as the generated REST router serves it. */
export interface CodeSnippet {
  slug: string;
  title: string;
  language: string;
  filename?: string | null;
  /**
   * ALWAYS present on a single-entity read, and that is the whole point of
   * `code` not being `contentBearing`: there is no second call handing over the
   * body, so the card renders from one `GET`.
   */
  code: string;
  tags?: string[];
}

const BASE = '/api/code-snippets';

export async function fetchCodeSnippet(slug: string): Promise<CodeSnippet | null> {
  const res = await apiFetch(`${BASE}/${encodeURIComponent(slug)}`);
  if (!res.ok) return null;
  return unwrap<CodeSnippet>(res);
}

export interface CodeSnippetInput {
  title: string;
  language?: string;
  filename?: string | null;
  code: string;
}

export async function createCodeSnippet(input: CodeSnippetInput): Promise<CodeSnippet> {
  const res = await apiFetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return unwrap<CodeSnippet>(res);
}

export async function updateCodeSnippet(
  slug: string,
  patch: Partial<CodeSnippetInput>,
): Promise<CodeSnippet> {
  const res = await apiFetch(`${BASE}/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return unwrap<CodeSnippet>(res);
}

/**
 * Re-read when the host says this entity changed — an external edit of the
 * entity file goes watcher → reindex → `entity:indexed`, and the card should
 * follow without a page reload.
 *
 * A raw `WebSocket` rather than a host hook because there is no published one;
 * the frame is host runtime behaviour, not plugin API. It degrades to silence:
 * a socket that cannot open just means no live update, which is far better than
 * throwing inside a Tiptap render.
 *
 * `/ws?project=<id>`, NOT `${API_BASE}/ws` — the gateway upgrades only when
 * `pathname === '/ws'`, and the spreadsheets envelope already paid for
 * discovering that the hard way.
 */
export function useEntityChanged(slug: string | null, onChange: () => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (typeof WebSocket === 'undefined' || !slug || !PROJECT_ID) return;
    let socket: WebSocket | null = null;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(
        `${proto}//${window.location.host}/ws?project=${encodeURIComponent(PROJECT_ID)}`,
      );
    } catch {
      return;
    }
    const onMessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        const kind = msg.kind;
        if (
          (kind === 'entity:changed' || kind === 'entity:indexed') &&
          msg.entityType === CODE_SNIPPET_TYPE &&
          msg.slug === slug
        ) {
          handler.current();
        }
      } catch {
        // Not every frame is JSON, and a non-JSON frame is not an error here.
      }
    };
    socket.addEventListener('message', onMessage);
    return () => {
      socket?.removeEventListener('message', onMessage);
      socket?.close();
    };
  }, [slug]);
}
