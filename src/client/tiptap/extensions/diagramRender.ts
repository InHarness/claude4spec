import type { EffectiveTheme } from '../../state/themeStore.js';

type MermaidModule = typeof import('mermaid').default;

let mermaidInstance: MermaidModule | null = null;
let loadingPromise: Promise<MermaidModule> | null = null;
/** Theme the memoised module was last `initialize()`d with. */
let initializedTheme: EffectiveTheme | null = null;

export const SUPPORTED_FORMATS = ['mermaid'] as const;
export type DiagramFormat = (typeof SUPPORTED_FORMATS)[number];

export function isSupportedFormat(fmt: string): fmt is DiagramFormat {
  return (SUPPORTED_FORMATS as readonly string[]).includes(fmt);
}

/**
 * The diagram palette, per effective theme. Values mirror the L12 token bridge
 * in `styles/theme.css` (`:root` = light, `.dark` = dark) — mermaid derives its
 * shades arithmetically from these, so it needs literal hex and cannot be
 * handed a `var(--c-…)`. Keep the two in sync when the design-system entity
 * (`c4s-paper-terra`) moves.
 */
const PALETTE: Record<EffectiveTheme, Record<string, string>> = {
  light: {
    card: '#fffdf8', // --c-card / color-card
    panel: '#f3efe7', // --c-panel / color-panel (paper-panel)
    terraInk: '#8a3a22', // --c-accent-ink / terra-ink
    ink: '#2a2722', // --c-ink / ink-900
    blue: '#5d7ea2', // --c-blue
    green: '#6e8a5f', // --c-green
  },
  dark: {
    card: '#2c2b27', // --c-card dark
    panel: '#242320', // --c-panel dark (paper-panel-dark)
    terraInk: '#f3b49a', // --c-accent-ink dark (terra-ink-dark)
    ink: '#ece7dc', // --c-ink dark (ink-100-dark)
    blue: '#8aa5c9', // --c-blue dark
    green: '#8fa87f', // --c-green dark
  },
};

/**
 * Full mermaid config for a theme. Pure — no module import, no side effects —
 * so it is unit-testable without pulling mermaid into the test env.
 *
 * `securityLevel`, `flowchart.curve` and `theme: 'base'` are theme-invariant;
 * only `themeVariables` differ. The dark set flips `darkMode`, which is what
 * makes mermaid derive its own shades downward instead of producing dark
 * colours on a light base.
 */
export function mermaidConfig(theme: EffectiveTheme) {
  const p = PALETTE[theme];
  return {
    startOnLoad: false,
    theme: 'base' as const,
    themeVariables: {
      darkMode: theme === 'dark',
      background: p.card,
      tertiaryColor: p.card,
      primaryColor: p.panel,
      primaryBorderColor: p.terraInk,
      lineColor: p.terraInk,
      textColor: p.ink,
      primaryTextColor: p.ink,
      secondaryColor: p.blue,
      secondaryTextColor: p.ink,
      secondaryBorderColor: p.blue,
      tertiaryTextColor: p.ink,
      tertiaryBorderColor: p.terraInk,
      clusterBkg: p.green,
      clusterBorder: p.green,
      titleColor: p.ink,
      edgeLabelBackground: p.card,
      nodeTextColor: p.ink,
    },
    flowchart: { curve: 'basis' as const },
    securityLevel: 'strict' as const,
  };
}

/**
 * Loads (once) and initialises mermaid for `theme`.
 *
 * The module is memoised, and mermaid keeps its `themeVariables` in module-level
 * config — so simply changing the palette does nothing until `initialize()` runs
 * again. Every render path funnels through here, which is what guarantees the
 * re-initialize happens BEFORE the re-render that follows a theme switch.
 */
export async function loadMermaid(theme: EffectiveTheme = 'light'): Promise<MermaidModule> {
  if (!mermaidInstance) {
    if (!loadingPromise) {
      loadingPromise = import('mermaid').then((mod) => {
        mermaidInstance = mod.default;
        return mermaidInstance;
      });
    }
    await loadingPromise;
  }
  const m = mermaidInstance!;
  if (initializedTheme !== theme) {
    m.initialize(mermaidConfig(theme));
    initializedTheme = theme;
  }
  return m;
}

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; message: string; line?: number };

export async function renderDiagram(
  format: string,
  source: string,
  id: string,
  theme: EffectiveTheme = 'light',
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
    const m = await loadMermaid(theme);
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
