import { useCallback } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { openPopover, type ChipNodeType } from '../../../ui/events.js';

export interface AltClickOptions {
  onRemove?: () => void | Promise<void>;
}

export function useEditChipOnAltClick(props: NodeViewProps, options: AltClickOptions = {}) {
  const { onRemove } = options;
  return useCallback(
    async (event: React.MouseEvent) => {
      if (!event.altKey) return false;
      event.preventDefault();
      event.stopPropagation();
      const anchor = event.currentTarget as HTMLElement;
      const rect = anchor.getBoundingClientRect();
      const nodeType = props.node.type.name as ChipNodeType;
      const result = await openPopover(
        'edit-chip',
        { x: rect.left, y: rect.bottom + 4 },
        {
          nodeType,
          attrs: { ...props.node.attrs },
          onRemove: () => {
            if (onRemove) void onRemove();
            else props.deleteNode();
          },
        },
      );
      if (result) {
        props.updateAttributes(result);
      }
      return true;
    },
    [props, onRemove],
  );
}
