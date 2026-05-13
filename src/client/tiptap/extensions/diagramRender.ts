type MermaidModule = typeof import('mermaid').default;

let mermaidInstance: MermaidModule | null = null;
let loadingPromise: Promise<MermaidModule> | null = null;

export const SUPPORTED_FORMATS = ['mermaid'] as const;
export type DiagramFormat = (typeof SUPPORTED_FORMATS)[number];

export function isSupportedFormat(fmt: string): fmt is DiagramFormat {
  return (SUPPORTED_FORMATS as readonly string[]).includes(fmt);
}

export async function loadMermaid(): Promise<MermaidModule> {
  if (mermaidInstance) return mermaidInstance;
  if (!loadingPromise) {
    loadingPromise = import('mermaid').then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          primaryColor: '#F3EDE1',
          primaryTextColor: '#2F2A25',
          primaryBorderColor: '#C4A57B',
          lineColor: '#8B5A2B',
          secondaryColor: '#E9DEC7',
          tertiaryColor: '#FFFBF4',
        },
        flowchart: { curve: 'basis' },
        securityLevel: 'strict',
      });
      mermaidInstance = m;
      return m;
    });
  }
  return loadingPromise;
}

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; message: string; line?: number };

export async function renderDiagram(
  format: string,
  source: string,
  id: string,
): Promise<RenderResult> {
  if (!isSupportedFormat(format)) {
    return {
      ok: false,
      message: `Unsupported format: ${format}. Supported: ${SUPPORTED_FORMATS.join(', ')}`,
    };
  }
  if (!source.trim()) {
    return { ok: false, message: 'Empty source' };
  }
  try {
    const m = await loadMermaid();
    await m.parse(source);
    const { svg } = await m.render(id, source);
    return { ok: true, svg };
  } catch (err) {
    const e = err as Error & { hash?: { loc?: { first_line?: number } } };
    return {
      ok: false,
      message: e?.message ?? 'Render failed',
      line: e?.hash?.loc?.first_line,
    };
  }
}

export function sanitizeRenderId(raw: string): string {
  return `diagram-${raw.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function hashSource(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
