import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * M34/L12 — the one-implementation rule, enforced against the source itself.
 *
 * For a component present in the catalog there is no host-internal twin: no
 * parallel markup reproducing its anatomy anywhere in the host. Where the host
 * needs a different *invocation* surface (an imperative bus), it builds a facade
 * around the catalog component — so the marker of a violation is not "imports
 * an event bus", it is "renders the anatomy": a full-viewport scrim, a
 * `--z-popover` panel, a `--z-toast` stack.
 *
 * There is no React Testing Library here, so this scans the sources as text —
 * the same approach `styles/theme.test.ts` takes for CSS invariants.
 */

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const KIT_DIR = join(CLIENT_DIR, 'host-ui-kit');

/**
 * 2.1.20 (M34 `hntah0r7`): the anatomy scan itself — host code AND every
 * envelope's sources, exceptions read from the consumers' `Host-local
 * components` declarations — lives in
 * `tests/integration/architecture/ui-kit-gate.ts` (+ `.test.ts`). This file
 * keeps the facade and stacking-tier checks of the rule.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const HOST_FILES = walk(CLIENT_DIR).filter((f) => !f.startsWith(KIT_DIR));

describe('M34/L12 — one implementation rule', () => {
  it('[ac:ac-hostowe-fasady-confirmmodal-popoverhost] the three imperative primitives render catalog components', () => {
    const facades = {
      'ui/Popover.tsx': /host-ui-kit\/overlay-feedback\/Popover\.js/,
      'ui/ConfirmModal.tsx': /host-ui-kit\/overlay\/Dialog\.js/,
      'ui/ToastHost.tsx': /host-ui-kit\/overlay-feedback\/ToastViewport\.js/,
      // Not imperative facades, but the same rule: the window shell is the
      // catalog's, the content stays with the owning slice (M28 / M33).
      'ui/modals/GitSyncRecover.tsx': /host-ui-kit\/overlay\/Dialog\.js/,
      'components/TrustPluginsModal.tsx': /host-ui-kit\/overlay\/Dialog\.js/,
    };
    for (const [file, importPattern] of Object.entries(facades)) {
      const src = readFileSync(join(CLIENT_DIR, file), 'utf8');
      expect(src, `${file} must import its catalog component`).toMatch(importPattern);
    }
  });

  it('[ac:ac-kontrakty-imperatywnych-fasad-openpopove] the imperative contracts keep their signatures', () => {
    // The facades changed what renders, never how they are called — and since
    // 0.2.110 (M50) the four signatures are pinned as the shell declares them:
    // `openPopover(kind, { x, y, ...props })`, `openModal(kind, props)`,
    // `confirmDestructive(kind, { title, body, confirmLabel })`, `toast.*`.
    const events = readFileSync(join(CLIENT_DIR, 'ui/events.ts'), 'utf8');
    expect(events).toMatch(
      /export function openPopover<K extends PopoverKind>\(\s*kind: K,\s*input: PopoverPosition & PopoverProps<K>,/,
    );
    expect(events).toMatch(/export function openModal<K extends ModalKind>\(\s*kind: K,\s*props: ModalProps<K>,/);
    expect(events).toMatch(/export function confirmDestructive\(kind: ConfirmKind, input: ConfirmInput\)/);
    expect(events).toMatch(/export const toast = \{/);
    // `c4s:toast` names the severity `variant`; a toast has no `kind`.
    expect(events).toMatch(/const detail: ToastRequest = \{ variant, message, \.\.\.options \}/);
  });

  it('[ac:ac-panel-detalu-endpointu-renderuje-badge-m] endpoint detail composes its method badge and Linked DTOs from the catalog', () => {
    // 0.2.2: the panel moved into the builtin envelope with its type. The
    // one-implementation rule follows the code — a catalog component smuggled
    // back into a bespoke widget is exactly as much a violation there.
    const src = readFileSync(
      join(REPO_ROOT, 'plugins/c4s-plugin-api-contracts/src/entity/endpoint/frontend/detail-panel.tsx'),
      'utf8',
    );
    expect(src).toMatch(/EnumBadgePicker/);
    expect(src).toMatch(/GroupedRelationPicker/);
    // The specialised widgets these replaced must not have come back.
    expect(src).not.toMatch(/\bMethodBadge\b/);
  });

  it('the plugin trust gate is an undismissable Dialog', () => {
    // The security property, pinned in source: no scrim/Escape/✕ escape hatch,
    // so the only ways out are the two explicit footer buttons.
    //
    // This repo has no DOM test environment (vitest runs `environment: 'node'`,
    // no jsdom, no RTL — see the file header), so each guard is pinned as text
    // and the *behaviour* is covered by tests/e2e/plugin-trust-gate.test.ts
    // against a live app. Asserting only that the strings `dismissible={false}`
    // and `dismissible = true` exist would stay green if the guards themselves
    // were deleted, which is exactly the regression that matters.
    const src = readFileSync(join(CLIENT_DIR, 'components/TrustPluginsModal.tsx'), 'utf8');
    expect(src).toMatch(/dismissible=\{false\}/);
    // 0.2.110 M33/M50: opened as the `project-plugins-trust` modal kind with
    // `dismissible: false`, which `ModalHost` never replaces with a newcomer.
    expect(src).toMatch(/'project-plugins-trust',[\s\S]*?\{ dismissible: false \}/);
    // A gate another overlay can paint over cannot be answered.
    expect(src).toMatch(/zIndex=\{1300\}/);
    // 2.1.28 (M33 `gox0ptn4`): the two answers are catalog ActionButtons, not
    // hand-styled <button>s.
    expect(src).toMatch(/host-ui-kit\/actions\/ActionButton\.js/);
    expect(src).not.toMatch(/<button\b/);

    const dialog = readFileSync(join(KIT_DIR, 'overlay/Dialog.tsx'), 'utf8');
    expect(dialog, 'dismissible must default to true').toMatch(/dismissible = true/);
    // Escape is guarded.
    expect(dialog, 'Escape must be suppressed when not dismissible').toMatch(
      /if \(e\.key === 'Escape'\) \{\s*\n\s*if \(!dismissibleRef\.current\) return;/,
    );
    // The scrim neither closes NOR blurs into <body> (which would put focus
    // outside the Tab trap and let keyboard focus walk into the shell behind).
    expect(dialog, 'scrim must not close a non-dismissible dialog').toMatch(
      /if \(!dismissible\) \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?return;/,
    );
    // Focus that ended up outside the panel is pulled back on Tab.
    expect(dialog, 'Tab must recover focus that left the panel').toMatch(
      /if \(!panel\.contains\(document\.activeElement\)\) \{/,
    );
    // The ✕ is a close path too, so it is gone with the others.
    expect(dialog, 'the header ✕ must be hidden when not dismissible').toMatch(
      /\{dismissible && \(\s*\n\s*<button/,
    );
  });

  it('every Dialog has an accessible name', () => {
    // `role="dialog"` with no name is announced as a bare "dialog" — for the
    // trust gate that means an unnamed, unescapable modal asking permission to
    // run foreign code.
    const dialog = readFileSync(join(KIT_DIR, 'overlay/Dialog.tsx'), 'utf8');
    expect(dialog).toMatch(/aria-labelledby=\{title != null \? titleId : undefined\}/);
    expect(dialog).toMatch(/aria-label=\{title == null \? ariaLabel : undefined\}/);
    expect(dialog).toMatch(/id=\{titleId\}/);
  });

  it('[ac:ac-dla-komponentu-obecnego-w-katalogu-l12-n] no host overlay stacks below the --z-popover tier', () => {
    // The anatomy scan (`tests/integration/architecture/ui-kit-gate.ts`) recognises a Popover twin by `var(--z-popover)`
    // — so a twin that spells its stacking as a bare number is invisible to it.
    // That is exactly how the sidebar OTHERS flyout hid: `position: 'fixed'`
    // with `zIndex: 60`, which painted it *under* `ActionBar` (900) and made
    // its lower items unclickable on the plan page.
    //
    // Deliberately narrow: only a `position: 'fixed'` block counts. In-flow
    // `absolute` layering (ResizeHandle, diagram toolbars, anchored dropdowns)
    // legitimately uses small numbers and is not an overlay tier.
    const FIXED_THEN_Z = /position:\s*'fixed'[^}]*?zIndex:\s*(\d+)/g;
    const Z_THEN_FIXED = /zIndex:\s*(\d+)[^}]*?position:\s*'fixed'/g;
    const offenders: string[] = [];
    for (const file of HOST_FILES) {
      const src = readFileSync(file, 'utf8');
      for (const re of [FIXED_THEN_Z, Z_THEN_FIXED]) {
        re.lastIndex = 0;
        for (const m of src.matchAll(re)) {
          if (Number(m[1]) < 1100) offenders.push(`${relative(CLIENT_DIR, file)}: zIndex ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
