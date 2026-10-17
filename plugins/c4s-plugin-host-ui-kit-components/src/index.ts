/**
 * Backend entry — what the host loader imports.
 *
 * REACT-FREE by contract: this module graph is imported into a Node process
 * with no DOM. `test/backend-entry-is-react-free.test.ts` walks it.
 */
export { manifest } from './manifest.js';
export { manifest as default } from './manifest.js';
