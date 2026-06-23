/**
 * M33 phase 3 — normalize declarative `contributes.commands` into editor slash
 * extensions. Each entry is routed through `registerEditorExtension(...)` — the
 * SAME registry path as entity-borne extensions — carrying only a `slashCommand`
 * (no schema extension): a declarative command contributes a trigger + popover,
 * not a node type. Execution is the editor framework's popover dispatch
 * (`pluginPopoverKind`), not plugin logic. An invalid/duplicate entry is skipped
 * with a warning (parity with L8 slot validation), never a mount error.
 */

import { ALL_EDITOR_CONTEXTS, registerEditorExtension, type EditorContextId } from './registry.js';
import type { PluginCommandContribution } from '../../shared/plugin-host/manifest.js';

/** Prefix so plugin command registrations never collide with built-in extension names. */
const PLUGIN_CMD_PREFIX = 'plugin-cmd:';

export function registerPluginCommands(commands: PluginCommandContribution[]): void {
  for (const cmd of commands) {
    if (!cmd?.name || !cmd.trigger || !cmd.popoverKind) {
      console.warn('[plugin-host] skipping malformed plugin command:', cmd);
      continue;
    }
    const availableIn = (cmd.availableIn ?? []).filter((c): c is EditorContextId =>
      (ALL_EDITOR_CONTEXTS as string[]).includes(c),
    );
    try {
      registerEditorExtension({
        name: `${PLUGIN_CMD_PREFIX}${cmd.name}`,
        availableIn: availableIn.length > 0 ? availableIn : undefined,
        slashCommand: {
          id: cmd.name,
          label: cmd.label,
          description: cmd.label,
          hint: `/${cmd.trigger}`,
          pluginPopoverKind: cmd.popoverKind,
        },
      });
    } catch (err) {
      console.warn(`[plugin-host] failed to register plugin command "${cmd.name}": ${(err as Error).message}`);
    }
  }
}
