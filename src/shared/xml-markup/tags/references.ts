import { registerXmlTag } from '../registry.js';

/**
 * M19 — References: the five entity tags. The target type always comes from
 * the `type` attribute; the look comes from the active type's render slot.
 * Registered WITHOUT `validate`: whether a slug / tag exists is project state,
 * checked by M19 against the current context (page write, consistency check).
 *
 * `single_element.caption` is optional advisory prose belonging to this
 * reference, not to the entity — a tag written without it never gains one.
 */
registerXmlTag({ name: 'inline_mention', attrOrder: ['type', 'slug'], form: 'inline' });
registerXmlTag({ name: 'single_element', attrOrder: ['type', 'slug', 'caption'] });
registerXmlTag({ name: 'element_list', attrOrder: ['type', 'slugs'] });
registerXmlTag({ name: 'tagged_list', attrOrder: ['type', 'tags', 'filter'] });
registerXmlTag({ name: 'tagged_list_mixed', attrOrder: ['tags', 'filter'] });
