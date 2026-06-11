import { afterEach } from 'vitest';
import { clearExtensionReferenceTypes } from '../src/shared/reference-extensions.js';

// The extension reference registry is a module-level Map; reset it so tests
// that register extension tags never leak into each other.
afterEach(() => {
  clearExtensionReferenceTypes();
});
