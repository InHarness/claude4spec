import { assignTagRender } from '../../renders.js';
import { registerTagPopoverFields } from '../../popover-fields.js';
import { InlineMentionRender } from './InlineMention.js';
import { SingleElementRender } from './SingleElement.js';
import { ElementListRender } from './ElementList.js';
import { TaggedListRender } from './TaggedList.js';
import { TaggedListMixedRender } from './TaggedListMixed.js';
import { REFERENCE_FIELDS } from './fields.js';

/**
 * M19 — References, browser side: the render and the popover fields of the
 * five entity tags. The look of each target comes from the active entity
 * type's render slot (`renderChip` / `renderCard` / `renderRow`), picked at
 * render time by the tag's `type` attribute.
 */
assignTagRender('inline_mention', InlineMentionRender);
assignTagRender('single_element', SingleElementRender);
assignTagRender('element_list', ElementListRender);
assignTagRender('tagged_list', TaggedListRender);
assignTagRender('tagged_list_mixed', TaggedListMixedRender);

for (const [name, fields] of Object.entries(REFERENCE_FIELDS)) registerTagPopoverFields(name, fields);
