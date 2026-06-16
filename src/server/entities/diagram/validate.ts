/**
 * Best-effort diagram `source` validation (M19 — warnings only, NEVER blocks a
 * write). An empty array means "no complaints", which also covers:
 *   - a non-mermaid format (only `mermaid` is implemented),
 *   - an empty source (legal placeholder),
 *   - any environment where mermaid cannot be loaded server-side (we simply
 *     cannot validate — so we stay silent rather than emit a misleading warning).
 */
export async function validateDiagramSource(format: string, source: string): Promise<string[]> {
  if (format !== 'mermaid') return [];
  if (!source.trim()) return [];

  let parse: ((s: string) => Promise<unknown>) | null = null;
  try {
    const mod = (await import('mermaid')) as { default?: unknown };
    const mermaid = (mod.default ?? mod) as { parse?: (s: string) => Promise<unknown> };
    if (typeof mermaid.parse === 'function') parse = mermaid.parse.bind(mermaid);
  } catch {
    return []; // mermaid unavailable in this runtime — cannot validate, never block
  }
  if (!parse) return [];

  try {
    await parse(source);
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [`mermaid source may be invalid: ${message.split('\n')[0]}`];
  }
}
