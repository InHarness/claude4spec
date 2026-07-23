import { describe, it, expect } from 'vitest';
import { mermaidConfig } from './diagramRender.js';

/**
 * The diagram palette is the L12 token bridge projected into mermaid's
 * `themeVariables`. Mermaid derives its shades arithmetically, so it needs
 * literal hex and cannot be handed a `var(--c-…)` — which means these values
 * are a hand-kept mirror of `styles/theme.css`. These tests are what stops the
 * two from silently drifting apart.
 */

/** Values copied from `styles/theme.css` — `:root` (light) and `.dark`. */
const TOKENS = {
  light: { card: '#fffdf8', panel: '#f3efe7', terraInk: '#8a3a22', ink: '#2a2722' },
  dark: { card: '#2c2b27', panel: '#242320', terraInk: '#f3b49a', ink: '#ece7dc' },
} as const;

describe('mermaidConfig', () => {
  it('maps the light palette onto mermaid theme variables', () => {
    const v = mermaidConfig('light').themeVariables;
    expect(v.background).toBe(TOKENS.light.card);
    expect(v.tertiaryColor).toBe(TOKENS.light.card);
    expect(v.primaryColor).toBe(TOKENS.light.panel);
    expect(v.lineColor).toBe(TOKENS.light.terraInk);
    expect(v.primaryBorderColor).toBe(TOKENS.light.terraInk);
    expect(v.textColor).toBe(TOKENS.light.ink);
    expect(v.primaryTextColor).toBe(TOKENS.light.ink);
    expect(v.darkMode).toBe(false);
  });

  it('maps the dark palette onto mermaid theme variables', () => {
    const v = mermaidConfig('dark').themeVariables;
    expect(v.background).toBe(TOKENS.dark.card);
    expect(v.tertiaryColor).toBe(TOKENS.dark.card);
    expect(v.primaryColor).toBe(TOKENS.dark.panel);
    expect(v.lineColor).toBe(TOKENS.dark.terraInk);
    expect(v.primaryBorderColor).toBe(TOKENS.dark.terraInk);
    expect(v.textColor).toBe(TOKENS.dark.ink);
    expect(v.primaryTextColor).toBe(TOKENS.dark.ink);
  });

  it('flips darkMode so mermaid derives its own shades downward', () => {
    expect(mermaidConfig('dark').themeVariables.darkMode).toBe(true);
    expect(mermaidConfig('light').themeVariables.darkMode).toBe(false);
  });

  it('is a full dark theme, not dark accents on a light canvas', () => {
    const light = mermaidConfig('light').themeVariables;
    const dark = mermaidConfig('dark').themeVariables;
    // Every colour that carries the diagram's readability must differ.
    for (const key of ['background', 'primaryColor', 'lineColor', 'textColor'] as const) {
      expect(dark[key], `${key} must differ between themes`).not.toBe(light[key]);
    }
    // Dark canvas, light ink — the inverse of the light set.
    expect(dark.background).toBe(TOKENS.dark.card);
    expect(dark.textColor).toBe(TOKENS.dark.ink);
  });

  it('keeps the theme-invariant render contract in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const cfg = mermaidConfig(theme);
      expect(cfg.securityLevel).toBe('strict');
      expect(cfg.flowchart.curve).toBe('basis');
      expect(cfg.theme).toBe('base');
      expect(cfg.startOnLoad).toBe(false);
    }
  });
});
