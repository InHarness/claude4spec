import { registerXmlTag } from '../registry.js';

/**
 * M08 — TODOs: `<todo comment="…"/>`. Carries its own content and points at
 * nothing, so there is no broken state and nothing to validate. The NAME is
 * registered, never an occurrence — a todo exists by being written in the text.
 */
registerXmlTag({ name: 'todo', attrOrder: ['comment'], form: 'inline' });
