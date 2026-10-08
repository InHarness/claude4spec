/**
 * Vite's `?raw` suffix, declared for `tsc --noEmit`.
 *
 * The style's package travels as literals compiled into this module (see
 * `vite.config.ts`), and the markdown behind those literals stays as real files
 * so it remains reviewable. That is the only reason this declaration exists —
 * the bundler needs no help, only the type-checker does.
 */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
