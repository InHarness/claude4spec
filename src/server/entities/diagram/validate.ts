/**
 * Best-effort diagram `source` validation (M19 — warnings only, NEVER blocks a
 * write). An empty array means "no complaints", which also covers:
 *   - a non-mermaid format (only `mermaid` is implemented),
 *   - an empty source (legal placeholder),
 *   - any environment where mermaid cannot be loaded server-side (we simply
 *     cannot validate — so we stay silent rather than emit a misleading warning).
 *
 * Why the headless DOM below: `mermaid.parse()` sanitizes diagram label text
 * through DOMPurify. In plain Node the `dompurify` default export is an
 * *uninitialized factory* (`isSupported: false`, no `addHook`, no `sanitize`),
 * so `parse()` threw `TypeError: DOMPurify.addHook is not a function` on every
 * classDiagram / stateDiagram-v2 / gantt / pie / journey / mindmap / HTML-label
 * flowchart / `accTitle:` sequenceDiagram — and that *environment* failure got
 * reported as a *source-syntax* complaint. Installing a happy-dom `window` only
 * for the duration of the mermaid import lets DOMPurify initialize properly;
 * the globals are restored immediately afterwards so the server process is
 * never left with a fake `window` (DOMPurify keeps its own captured reference,
 * so `parse()` keeps working).
 *
 * Note we do NOT simply swallow the DOMPurify TypeError: it is thrown *during*
 * parsing, before the parser reaches the rest of the source, so "valid first
 * statement then garbage" would validate clean — a false negative in a linter
 * whose only job is catching syntax errors early.
 */

type ParseFn = (s: string) => Promise<unknown>;

/** Globals happy-dom must provide while mermaid (→ DOMPurify) initializes. */
const DOM_GLOBALS = [
  'window',
  'document',
  'DOMParser',
  'Node',
  'Element',
  'HTMLElement',
  'NodeFilter',
  'navigator',
] as const;

/**
 * Memoized so the set/restore of `globalThis` can never interleave between two
 * concurrent validations: every caller awaits the same single import.
 */
let mermaidParse: Promise<ParseFn | null> | null = null;

async function importMermaidWithDom(): Promise<ParseFn | null> {
  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  let win: { happyDOM: { close: () => Promise<void> } } | null = null;

  try {
    const { Window } = await import('happy-dom');
    const w = new Window({ url: 'http://localhost' });
    win = w as unknown as { happyDOM: { close: () => Promise<void> } };

    for (const key of DOM_GLOBALS) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    for (const key of DOM_GLOBALS) {
      const value = key === 'window' ? w : (w as unknown as Record<string, unknown>)[key];
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }

    const mod = (await import('mermaid')) as { default?: unknown };
    const mermaid = (mod.default ?? mod) as { parse?: ParseFn };
    return typeof mermaid.parse === 'function' ? mermaid.parse.bind(mermaid) : null;
  } catch {
    return null; // no DOM or no mermaid in this runtime — cannot validate, never block
  } finally {
    for (const [key, descriptor] of saved) {
      delete anyGlobal[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    }
    // Release happy-dom's timers/observers so the DOM never keeps a CLI process alive.
    await win?.happyDOM.close().catch(() => {});
  }
}

function ensureMermaid(): Promise<ParseFn | null> {
  mermaidParse ??= importMermaidWithDom();
  return mermaidParse;
}

export async function validateDiagramSource(format: string, source: string): Promise<string[]> {
  if (format !== 'mermaid') return [];
  if (!source.trim()) return [];

  const parse = await ensureMermaid();
  if (!parse) return [];

  try {
    await parse(source);
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [`mermaid source may be invalid: ${message.split('\n')[0]}`];
  }
}
