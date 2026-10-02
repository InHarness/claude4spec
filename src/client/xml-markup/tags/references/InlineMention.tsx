import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import type { TagRenderProps } from '../../renders.js';
import { attr, EntityChip } from './shared.js';

/** `<inline_mention type slug/>` — the type's `renderChip` slot. */
export function InlineMentionRender({ attrs, onBrokenChange }: TagRenderProps) {
  // Re-render when a plugin frontend registers: this chip can mount before the
  // envelope that owns its type has finished loading.
  useRegistryVersion();
  return <EntityChip type={attr(attrs, 'type')} slug={attr(attrs, 'slug')} onBroken={onBrokenChange} />;
}
