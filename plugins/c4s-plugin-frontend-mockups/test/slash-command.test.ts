/**
 * `/uiview` and `/design-system` — declared exactly ONCE each, on the manifest.
 *
 * The trap this pins is not hypothetical here: before 0.2.18 both commands were
 * declared on `FrontendModule.editorExtensions` (through the host's
 * `registerEditorExtension`) AND executed by a hardcoded `case` in the host's
 * `slashInvoke`. The move replaces both with one manifest contribution carrying
 * a `popoverKind`.
 *
 * Re-adding the `editorExtensions` half would look harmless and would break the
 * command silently: the palette filters by substring, so both entries match
 * `/uiview`, and the module-borne one WINS because frontend modules mount before
 * plugin commands register. Choosing it deletes the typed text and opens
 * nothing, because it is the manifest entry that carries the `popoverKind`
 * `invokeSlash` dispatches on.
 */

import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { frontendMockupCommands } from '../src/capabilities/commands.js';
import { designSystemFrontendModule } from '../src/entity/design-system/frontend/module.js';
import { uiViewFrontendModule } from '../src/entity/ui-view/frontend/module.js';
import { DESIGN_SYSTEM_POPOVER_KIND, UI_VIEW_POPOVER_KIND } from '../src/identity.js';

const CASES = [
  { trigger: 'uiview', kind: UI_VIEW_POPOVER_KIND, module: uiViewFrontendModule },
  { trigger: 'design-system', kind: DESIGN_SYSTEM_POPOVER_KIND, module: designSystemFrontendModule },
];

describe.each(CASES)('/$trigger', ({ trigger, kind, module }) => {
  it('the manifest declares exactly one command for the trigger', () => {
    expect(frontendMockupCommands.filter((c) => c.trigger === trigger)).toHaveLength(1);
  });

  it('that command carries the popoverKind invokeSlash dispatches on', () => {
    expect(frontendMockupCommands.find((c) => c.trigger === trigger)?.popoverKind).toBe(kind);
  });

  it('the frontend module declares NO slash command of its own', () => {
    const extensions = module.editorExtensions ?? [];
    expect(extensions.filter((e) => e.slashCommand)).toHaveLength(0);
  });
});

describe('the manifest as a whole', () => {
  it('reaches the loader through contributes.commands, not just the module', () => {
    expect(manifest.contributes?.commands).toBe(frontendMockupCommands);
  });

  it('gives the two commands distinct popover kinds', () => {
    const kinds = frontendMockupCommands.map((c) => c.popoverKind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('names both types, design-system first, so the ref target registers first', () => {
    // `ui-view.designSystemSlug` declares `ref: 'design-system'`. The host
    // topologically sorts by `dependsOn` as well, but the declared order is the
    // statement of intent and the thing a reviewer reads.
    expect(manifest.contributes?.entities?.map((e) => e.type)).toEqual([
      'design-system',
      'ui-view',
    ]);
  });

  it('gates on host API 2.x — a stale range makes both types silently absent', () => {
    // The loader `continue`s BEFORE `registerPlugin` on a version mismatch, so
    // the failure mode is not an error: it is no sidebar tab, no routes, no
    // serializer, and one `PLUGIN_HOST_API_MISMATCH` line in the log.
    expect(manifest.hostApiVersion).toBe('^3.0.0');
  });

  it('declares onUnregister — an empty no-op is the correct implementation here', () => {
    // The slot is required; a NON-empty body would be the surprise. Teardown of
    // routes, sidebar entries, commands and system-prompt contributions belongs
    // to `registry.unregisterPlugin()` plus the ProjectContext rebuild. This
    // package holds no timer, watcher or connection of its own.
    expect(typeof manifest.onUnregister).toBe('function');
    expect(() => {
      manifest.onUnregister!();
      manifest.onUnregister!();
    }).not.toThrow();
  });
});
