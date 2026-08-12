/** @type {import('tailwindcss').Config} */
export default {
  // `plugins/*/src` is scanned because built-in envelopes render into the same
  // document and share this one stylesheet — nothing in their bundle emits CSS
  // of its own. Extracting `ui-view`/`design-system` in 0.2.18 was the first
  // move to take arbitrary utilities (`text-[14.5px]`, `text-[9px]`, `pr-4`)
  // out of `src/client` entirely, which silently stopped generating them.
  content: [
    './src/client/index.html',
    './src/client/**/*.{ts,tsx}',
    './plugins/*/src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
