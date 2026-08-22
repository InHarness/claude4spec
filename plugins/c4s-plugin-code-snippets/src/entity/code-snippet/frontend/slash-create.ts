import { createElement } from 'react';
import { CODE_SNIPPET_POPOVER_KIND } from '../../../identity.js';
import { mountSlashCreatePopover } from '../../../frontend-kit/slash-create.js';
import { CodeSnippetCreatePopover } from './popover.js';

/**
 * Wire `/code-snippet` to its create popover.
 *
 * Idempotent per kind — `mountSlashCreatePopover` disposes any previous mount
 * for the same kind before installing this one, which is what keeps a plugin
 * reload from stacking listeners (and, with them, creating N entities from one
 * invocation).
 */
export function mountCodeSnippetSlashCreate(): () => void {
  return mountSlashCreatePopover(CODE_SNIPPET_POPOVER_KIND, (props) =>
    createElement(CodeSnippetCreatePopover, props),
  );
}
