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
const KIT_DIR = join(CLIENT_DIR, 'host-ui-kit');

/**
 * Anatomy the catalog owns, as it appears in source. Each entry is a component
 * whose markup may exist in exactly one place: its catalog file.
 */
const ANATOMY = [
  { component: 'Popover', pattern: /var\(--z-popover\)/ },
  { component: 'ToastViewport', pattern: /var\(--z-toast\)/ },
  // A modal twin is a full-viewport scrim with a centred panel, however its
  // stacking happens to be spelled. Matching only `Dialog`'s own `zIndex: 1200`
  // would let every twin hide behind a different z-index — and in fact all five
  // pending ones below use Tailwind's `z-50`, so a narrower pattern reported a
  // clean catalog while they sat in plain sight. `items-center justify-center`
  // is what separates a dialog from a fullscreen viewer (`flex flex-col`).
  {
    component: 'Dialog',
    pattern: /zIndex:\s*1[23]00|fixed inset-0[^"]*items-center justify-center/,
  },
] as const;

/** Reason shared by every twin whose migration is tracked by the analysis brief. */
const PENDING = 'Pending migration to Dialog — see analysis brief 0-1-144-to-next.md.';

/**
 * Host slices that still render their own scrim, with the reason each one does
 * not currently pass through `Dialog`. These are declared, not tolerated
 * silently — the point of the rule is that an undeclared twin is a violation.
 * Emptying this list is the goal; adding to it needs a justification here.
 *
 * Two kinds of entry, and the difference matters: the first two are standing
 * exceptions — anatomy `Dialog` genuinely cannot express. The rest are twins
 * awaiting migration, tracked by a brief; that group is expected to shrink to
 * nothing, and nothing new belongs in it.
 *
 * `TrustPluginsModal` used to sit here ("must NOT be dismissible, but Dialog
 * always closes on Escape/scrim") — 0.2.1 gave `Dialog` a `dismissible` prop,
 * so the reason expired and the gate is now a facade like the rest.
 */
const DECLARED_EXCEPTIONS: Record<string, string> = {
  'chat/ToolJsonModal.tsx':
    'Raw-JSON viewer at 1100px — wider than any of Dialog\'s size tiers.',
  'components/DiagramFullscreen.tsx':
    'Host-local per the diagram slice: a fullscreen pan+zoom canvas, not a sized Dialog panel.',

  // Pending migration — 480px scrim+panel twins that `Dialog` (with the `width`
  // prop added in this release) covers as-is. Each also lacks the Escape
  // handling, Tab trap and focus restore `Dialog` owns. Routed as an analysis
  // brief rather than folded into this release, whose scope is the three
  // imperative facades.
  'components/CreateBriefDialog.tsx': PENDING,
  'components/CreateReleaseDialog.tsx': PENDING,
  'components/AddProjectDialog.tsx': PENDING,
  'components/briefs/BriefScopeModal.tsx': PENDING,
  // Additionally a twin of `confirmDestructive()` itself, with a `loading`
  // state the imperative contract has no slot for.
  'components/ReleaseDetail.tsx': PENDING,
};

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
  for (const { component, pattern } of ANATOMY) {
    it(`[ac:ac-dla-komponentu-obecnego-w-katalogu-l12-n] no host-internal twin of ${component}`, () => {
      const offenders = HOST_FILES.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) =>
        relative(CLIENT_DIR, f),
      );
      const undeclared = offenders.filter((f) => !(f in DECLARED_EXCEPTIONS));
      expect(undeclared).toEqual([]);
    });
  }

  it('[ac:ac-hostowe-fasady-confirmmodal-popoverhost] the three imperative primitives render catalog components', () => {
    const facades = {
      'ui/Popover.tsx': /host-ui-kit\/overlay-feedback\/Popover\.js/,
      'ui/ConfirmModal.tsx': /host-ui-kit\/overlay\/Dialog\.js/,
      'ui/ToastHost.tsx': /host-ui-kit\/overlay-feedback\/ToastViewport\.js/,
      // Not imperative facades, but the same rule: the window shell is the
      // catalog's, the content stays with the owning slice (M28 / M33).
      'ui/GitErrorRecoveryModal.tsx': /host-ui-kit\/overlay\/Dialog\.js/,
      'components/TrustPluginsModal.tsx': /host-ui-kit\/overlay\/Dialog\.js/,
    };
    for (const [file, importPattern] of Object.entries(facades)) {
      const src = readFileSync(join(CLIENT_DIR, file), 'utf8');
      expect(src, `${file} must import its catalog component`).toMatch(importPattern);
    }
  });

  it('[ac:ac-kontrakty-imperatywnych-fasad-openpopove] the imperative contracts keep their signatures', () => {
    // The facades changed what renders, never how they are called. If any of
    // these drifted, every consumer (SectionRefView, TodoView, PageRefPopover,
    // the edit-chip popovers, slashInvoke) would have to change with them —
    // which the brief names as the signal that a facade was built wrong.
    const events = readFileSync(join(CLIENT_DIR, 'ui/events.ts'), 'utf8');
    expect(events).toMatch(/export function openPopover<K extends PopoverKind>\(/);
    expect(events).toMatch(/export function confirmDestructive\(/);
    expect(events).toMatch(/export const toast = \{/);
  });

  it('[ac:ac-panel-detalu-endpointu-renderuje-badge-m] endpoint detail composes its method badge and Linked DTOs from the catalog', () => {
    const src = readFileSync(join(CLIENT_DIR, 'entities/endpoint/detail-panel.tsx'), 'utf8');
    expect(src).toMatch(/EnumBadgePicker/);
    expect(src).toMatch(/GroupedRelationPicker/);
    // The specialised widgets these replaced must not have come back.
    expect(src).not.toMatch(/\bMethodBadge\b/);
  });

  it('the plugin trust gate is an undismissable Dialog', () => {
    // The security property, pinned in source: no scrim/Escape/✕ escape hatch,
    // so the only ways out are the two explicit footer buttons.
    const src = readFileSync(join(CLIENT_DIR, 'components/TrustPluginsModal.tsx'), 'utf8');
    expect(src).toMatch(/dismissible=\{false\}/);
    const dialog = readFileSync(join(KIT_DIR, 'overlay/Dialog.tsx'), 'utf8');
    expect(dialog).toMatch(/dismissible = true/);
  });

  it('every declared exception still exists (the list cannot rot)', () => {
    for (const file of Object.keys(DECLARED_EXCEPTIONS)) {
      expect(() => statSync(join(CLIENT_DIR, file))).not.toThrow();
    }
  });
});
