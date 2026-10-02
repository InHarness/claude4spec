import { registerXmlTag } from '../registry.js';

/**
 * M06 — Sections: `<section_ref anchor="…"/>`. Registered WITHOUT `validate`:
 * whether an anchor exists depends on the section index of one project
 * context, and a closure over it would leak across projects through this
 * process-global registry. Rule 8 of the consistency check verifies it
 * against the current `ProjectContext`'s `SectionsService` instead.
 */
registerXmlTag({ name: 'section_ref', attrOrder: ['anchor'], form: 'inline' });
