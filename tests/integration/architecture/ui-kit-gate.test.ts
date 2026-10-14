/**
 * 2.1.20 — M34/L12 gate (a) "one implementation" checked automatically over the
 * host code and the sources of every envelope, with its exceptions read from
 * the consumers' `Host-local components` declarations (`host-local-declarations.ts`).
 *
 * One block per consumer section this release changed: each pins the
 * declarations the check reads for that section to what the section declares,
 * and the code to what the declarations say (debt headers, struck entries).
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOST_LOCAL_DECLARATIONS,
  declarationsOf,
  type HostLocalDeclaration,
} from './host-local-declarations.js';
import {
  ANATOMY_DETECTORS,
  CATALOG_DIR,
  DEBT_MARKER,
  REPO_ROOT,
  debtMarkedFiles,
  envelopeFiles,
  filesOfKind,
  hostFiles,
  hostInternalMarkedFiles,
  isOutOfScope,
  ownsMarkup,
  readSource,
  scanFindings,
  violations,
} from './ui-kit-gate.js';

const POPOVER_FORM = ['FieldLabel', 'TextInput', 'SelectInput', 'InlineError', 'PopoverFooter'];

/** What a section declares, without the file mapping. */
function entries(section: string): Array<Pick<HostLocalDeclaration, 'kind' | 'components' | 'replacedBy'>> {
  return declarationsOf(section).map(({ kind, components, replacedBy }) => ({
    kind,
    components: [...components],
    replacedBy: [...replacedBy],
  }));
}

const debt = (components: string[], replacedBy: string[] = []) => ({ kind: 'debt' as const, components, replacedBy });

/** Every name a section declares, flattened. */
const declaredNames = (section: string): string[] => declarationsOf(section).flatMap((d) => [...d.components]);

/** The findings the check reports for `file` once the given section's declarations are withdrawn. */
function violationsWithout(section: string, file: string) {
  return violations(HOST_LOCAL_DECLARATIONS.filter((d) => d.section !== section)).filter((v) => v.file === file);
}

/** The declarations of the other sections still cover `file`? (a file shared by two consumers) */
const coveredElsewhere = (section: string, file: string): boolean =>
  HOST_LOCAL_DECLARATIONS.some((d) => d.section !== section && d.files.includes(file));

const kit = (pkg: string, file: string) => `plugins/${pkg}/src/frontend-kit/${file}`;

describe('[section:hntah0r7] gate (a) — the automatic check over the host code and every envelope', () => {
  it('[section:hntah0r7] no undeclared twin of catalog anatomy and no undeclared own kit markup, in the host code or in the sources of any envelope', () => {
    expect(violations()).toEqual([]);
  });

  for (const { component } of ANATOMY_DETECTORS) {
    it(`[ac:ac-dla-komponentu-obecnego-w-katalogu-l12-n] [section:hntah0r7] no undeclared twin of ${component} in the host code or in any envelope`, () => {
      expect(violations().filter((v) => v.detector === `anatomy:${component}`)).toEqual([]);
    });
  }

  it('[section:hntah0r7] the check reaches the host code and the sources of every envelope, and finds markup on both sides', () => {
    const packages = readdirSync(join(REPO_ROOT, 'plugins')).filter((pkg) => {
      try {
        return statSync(join(REPO_ROOT, 'plugins', pkg, 'src')).isDirectory();
      } catch {
        return false;
      }
    });
    expect(packages.length).toBeGreaterThanOrEqual(8);
    const env = envelopeFiles();
    for (const pkg of packages) {
      expect(env.some((f) => f.startsWith(`plugins/${pkg}/src/`)), pkg).toBe(true);
    }
    const host = hostFiles();
    expect(host).toContain('src/client/components/ReleasesPage.tsx');
    // The catalog folder is the one place catalog anatomy lives — it is not scanned.
    expect(host.some((f) => f.startsWith(CATALOG_DIR))).toBe(false);

    const findings = scanFindings();
    expect(findings.some((f) => f.file.startsWith('src/client/'))).toBe(true);
    expect(findings.some((f) => f.file.startsWith('plugins/'))).toBe(true);
    expect(findings.some((f) => f.detector === 'kit-markup')).toBe(true);
  });

  it('[section:hntah0r7] exceptions are read only from the declarations — withdraw them and every finding is a violation', () => {
    const findings = scanFindings();
    expect(findings.length).toBeGreaterThan(0);
    expect(violations([])).toEqual(findings);
    // …and each exception the check grants traces back to a declared entry.
    const declared = new Set(HOST_LOCAL_DECLARATIONS.flatMap((d) => d.files));
    for (const f of findings) expect(declared.has(f.file), f.file).toBe(true);
  });

  it('[section:hntah0r7] declarations and code cannot drift: the DEBT headers in code are exactly the DŁUG entries, the host-internal header exactly the host-internal entries', () => {
    expect(debtMarkedFiles().sort()).toEqual(filesOfKind('debt'));
    expect(hostInternalMarkedFiles().sort()).toEqual(filesOfKind('host-internal'));
  });

  it('[section:hntah0r7] every declared file exists — the declarations cannot rot', () => {
    for (const file of HOST_LOCAL_DECLARATIONS.flatMap((d) => d.files)) {
      expect(existsSync(join(REPO_ROOT, file)), file).toBe(true);
    }
  });

  it('[section:hntah0r7] the editor surface (M20) and the chat overlay (M05) are outside the check and need no declaration', () => {
    expect(isOutOfScope('src/client/chat/ToolCard.tsx')).toBe(true);
    expect(isOutOfScope('src/client/ui/modals/ToolJsonView.tsx')).toBe(true);
    expect(isOutOfScope('src/client/tiptap/registrations.ts')).toBe(true);
    expect(isOutOfScope('src/client/components/ReleasesPage.tsx')).toBe(false);
    const host = hostFiles();
    expect(host.some((f) => f.startsWith('src/client/chat/') || f.startsWith('src/client/tiptap/'))).toBe(false);
    expect(host).not.toContain('src/client/ui/modals/ToolJsonView.tsx');
    // The chat's raw-JSON window keeps its own panel and is declared nowhere.
    expect(HOST_LOCAL_DECLARATIONS.flatMap((d) => d.files)).not.toContain('src/client/ui/modals/ToolJsonView.tsx');
  });

  it('[section:hntah0r7] the undeclared twins the wider check found are collapsed: no standalone BriefScopeModal, the module-dependency window is the catalog Dialog', () => {
    const brief = readSource('src/client/components/briefs/BriefScopeModal.tsx');
    expect(brief).not.toMatch(/export function BriefScopeModal\b/);
    expect(brief).toMatch(/export function BriefScopeFields\b/);
    const overlay = readSource(
      'plugins/c4s-plugin-layered-vertical-slices/src/entity/module-dependency/frontend/overlay.tsx',
    );
    expect(overlay).toMatch(/import \{[^}]*\bDialog\b[^}]*\} from '@c4s\/plugin-runtime\/ui'/);
    expect(overlay).toMatch(/<Dialog\b/);
    expect(overlay).not.toMatch(/fixed inset-0/);
    expect(declarationsOf('tiavwkux')).toEqual([]);
  });
});

describe('[section:v05js8rl] M17 Host UI Kit slice — one DŁUG: CreateReleaseDialog', () => {
  const file = 'src/client/components/CreateReleaseDialog.tsx';

  it('[section:v05js8rl] the check reads exactly one entry for M17: CreateReleaseDialog, DŁUG, replaced by Dialog', () => {
    expect(entries('v05js8rl')).toEqual([debt(['CreateReleaseDialog'], ['Dialog'])]);
    expect(declarationsOf('v05js8rl')[0]!.files).toEqual([file]);
  });

  it('[section:v05js8rl] the create-release window draws its own scrim and panel — a finding the M17 entry alone excuses', () => {
    expect(scanFindings()).toContainEqual({ file, detector: 'anatomy:Dialog' });
    expect(violationsWithout('v05js8rl', file)).toEqual([{ file, detector: 'anatomy:Dialog' }]);
    expect(readSource('src/client/components/ReleasesPage.tsx')).toMatch(/<CreateReleaseDialog\b/);
  });

  it('[section:v05js8rl] the file carries the DEBT header naming Dialog; the release detail still draws its line diff with the catalog DiffView', () => {
    const header = readSource(file).match(DEBT_MARKER);
    expect(header?.[0]).toContain('M17');
    expect(readSource(file)).toMatch(/replacement is `Dialog`/);
    expect(readSource('src/client/components/release/PageDiffCard.tsx')).toMatch(/\bDiffView\b/);
  });
});

describe('[section:q856s1vm] M21 Host UI Kit slice — three DŁUG entries', () => {
  it('[section:q856s1vm] the check reads exactly three DŁUG entries for M21, each with its catalog replacement', () => {
    expect(entries('q856s1vm')).toEqual([
      debt(['CreateBriefDialog'], ['Dialog']),
      debt(['SegmentedControl'], ['SegmentedControlTabs']),
      debt(['FileVersionHistory'], ['VersionHistory', 'DiffView']),
    ]);
    expect(declarationsOf('q856s1vm').flatMap((d) => d.files)).toEqual([
      'src/client/components/CreateBriefDialog.tsx',
      'src/client/components/SegmentedControl.tsx',
      'src/client/components/FileVersionHistory.tsx',
    ]);
  });

  it('[section:q856s1vm] the brief-generate window is a scrim twin the M21 entry alone excuses', () => {
    const file = 'src/client/components/CreateBriefDialog.tsx';
    expect(violationsWithout('q856s1vm', file)).toEqual([{ file, detector: 'anatomy:Dialog' }]);
  });

  it('[section:q856s1vm] the view switcher of briefs-list / brief-page and the brief version history are the declared host components, each with a DEBT header', () => {
    expect(readSource('src/client/components/BriefsList.tsx')).toMatch(/<SegmentedControl\b/);
    expect(readSource('src/client/components/BriefDetail.tsx')).toMatch(/<SegmentedControl\b/);
    expect(readSource('src/client/components/BriefDetail.tsx')).toMatch(/<FileVersionHistory\b/);
    for (const d of declarationsOf('q856s1vm')) {
      for (const file of d.files) {
        const src = readSource(file);
        expect(src.match(DEBT_MARKER)?.[0], file).toContain('M21');
        for (const r of d.replacedBy) expect(src, `${file} names ${r}`).toContain(`\`${r}\``);
      }
    }
  });
});

describe('[section:j6b1z37u] M31 Host UI Kit slice — ProjectCreate (DŁUG) and DirectoryPickerModal (host-internal)', () => {
  it('[section:j6b1z37u] the check reads two entries for M31: ProjectCreate as DŁUG replaced by Dialog, DirectoryPickerModal as a host-internal component', () => {
    expect(entries('j6b1z37u')).toEqual([
      debt(['ProjectCreate'], ['Dialog']),
      { kind: 'host-internal', components: ['DirectoryPickerModal'], replacedBy: [] },
    ]);
  });

  it('[section:j6b1z37u] the project-create window is a scrim twin the M31 entry alone excuses', () => {
    const file = 'src/client/ui/modals/ProjectCreate.tsx';
    expect(violationsWithout('j6b1z37u', file)).toEqual([{ file, detector: 'anatomy:Dialog' }]);
    expect(readSource(file).match(DEBT_MARKER)?.[0]).toContain('M31');
  });

  it('[section:j6b1z37u] DirectoryPickerModal: one implementation outside the catalog folder, not a catalog entry, unpublished, no catalog anatomy of its own, used by directory-browse and project-create', () => {
    const file = 'src/client/components/DirectoryPickerModal.tsx';
    expect(declarationsOf('j6b1z37u')[1]!.files).toEqual([file]);
    expect(file.startsWith(CATALOG_DIR)).toBe(false);
    // Not a catalog entry (the registry is read as text: importing it pulls in the editor).
    expect(readSource('src/client/host-ui-kit/registry.ts')).not.toMatch(/DirectoryPicker/);
    expect(readSource('src/client/host-ui-kit/index.ts')).not.toMatch(/DirectoryPicker/);
    expect(readSource('src/server/plugin-runtime/ui.ts')).not.toMatch(/DirectoryPicker/);
    // Its window shell is the catalog's Dialog — the check finds nothing in it.
    expect(scanFindings().filter((f) => f.file === file)).toEqual([]);
    expect(readSource(file)).toMatch(/HOST-INTERNAL COMPONENT \(2\.1\.20, Host UI Kit slice of M31/);
    // One implementation, two host consumers.
    const users = hostFiles().filter((f) => f !== file && /DirectoryPickerModal\.js'/.test(readSource(f)));
    // project-create embeds the browser; the directory-browse window of the settings dir fields opens the modal.
    expect(users).toContain('src/client/ui/modals/ProjectCreate.tsx');
    expect(users).toContain('src/client/components/settings/controls.tsx');
    expect(hostFiles().filter((f) => /export function DirectoryPickerModal\b/.test(readSource(f)))).toEqual([file]);
  });
});

/** Assertions shared by the envelope sections. */
function assertStruck(section: string, names: string[]): void {
  const declared = declaredNames(section);
  for (const n of names) expect(declared, `${section} must not declare ${n}`).not.toContain(n);
}

function assertTrajectoryDebts(section: string, pkg: string, withListLayout = true): void {
  const expected = [
    ...(withListLayout ? [{ component: 'ListPageLayout', file: kit(pkg, 'ListPageLayout.tsx') }] : []),
    { component: 'RoutePane', file: kit(pkg, 'route-shell.tsx') },
  ];
  for (const { component, file } of expected) {
    const d = declarationsOf(section).find((x) => x.components.includes(component));
    expect(d, `${section} declares ${component}`).toBeDefined();
    expect(d!.kind).toBe('debt');
    // The catalog has no replacement — a trajectory candidate.
    expect(d!.replacedBy).toEqual([]);
    expect(d!.files).toEqual([file]);
    const src = readSource(file);
    expect(src.match(DEBT_MARKER), `${file} DEBT header`).not.toBeNull();
    expect(src).toMatch(/candidate of the catalog trajectory/);
    expect(ownsMarkup(file), `${file} owns markup`).toBe(true);
    expect(violationsWithout(section, file).length > 0 || coveredElsewhere(section, file)).toBe(true);
  }
}

describe('[section:yrzqclyz] c4s-plugin-ac Host UI Kit slice', () => {
  const pkg = 'c4s-plugin-ac';

  it('[section:yrzqclyz] the check reads exactly the ac DŁUG entries — EntityBreadcrumbBar, EntityNotFound, the popover form, ListPageLayout, RoutePane', () => {
    expect(entries('yrzqclyz')).toEqual([
      debt(['EntityBreadcrumbBar'], ['DetailPanelShell']),
      debt(['EntityNotFound'], ['EmptyState']),
      debt(POPOVER_FORM, ['FormField']),
      debt(['ListPageLayout']),
      debt(['RoutePane']),
    ]);
  });

  it('[section:yrzqclyz] ListPageLayout and RoutePane are new debts with no catalog replacement, carried by the package kit with DEBT headers', () => {
    assertTrajectoryDebts('yrzqclyz', pkg);
  });

  it('[section:yrzqclyz] ListPageHeader, ListScrollArea and EntityViewSwitcher are struck: not declared, and EntityViewSwitcher composes only the catalog SegmentedControlTabs', () => {
    assertStruck('yrzqclyz', ['ListPageHeader', 'ListScrollArea', 'EntityViewSwitcher']);
    const file = kit(pkg, 'EntityViewSwitcher.tsx');
    expect(ownsMarkup(file)).toBe(false);
    expect(readSource(file)).not.toMatch(DEBT_MARKER);
    expect(readSource(file)).toMatch(/import \{ SegmentedControlTabs \} from '@c4s\/plugin-runtime\/ui'/);
    expect(scanFindings().filter((f) => f.file === file)).toEqual([]);
  });

  it('[section:yrzqclyz] every own-markup file of the ac kit is covered by an ac entry', () => {
    const ownMarkup = scanFindings().filter((f) => f.file.startsWith(`plugins/${pkg}/src/frontend-kit/`));
    const files = new Set(declarationsOf('yrzqclyz').flatMap((d) => d.files));
    expect(ownMarkup.length).toBeGreaterThan(0);
    for (const f of ownMarkup) expect(files.has(f.file), f.file).toBe(true);
  });
});

function apiContractsCase(section: string, type: string): void {
  const pkg = 'c4s-plugin-api-contracts';

  it(`[section:${section}] the check reads the ${type} DŁUG entries — EntityBreadcrumbBar, EntityViewSwitcher, SegmentedControl, ButtonGroup + SegmentButton, TagChip, the popover form, ListPageLayout, RoutePane`, () => {
    expect(entries(section)).toEqual([
      debt(['EntityBreadcrumbBar'], ['DetailPanelShell']),
      debt(['EntityViewSwitcher'], ['SegmentedControlTabs']),
      debt(['SegmentedControl'], ['SegmentedControlTabs']),
      debt(['ButtonGroup', 'SegmentButton'], ['SegmentedControlTabs']),
      debt(['TagChip'], ['Badge']),
      debt(POPOVER_FORM, ['FormField']),
      debt(['ListPageLayout']),
      debt(['RoutePane']),
    ]);
  });

  it(`[section:${section}] EntityViewSwitcher is the package's own implementation on the local SegmentedControl / ButtonGroup debts, not on a catalog component`, () => {
    const switcher = readSource(kit(pkg, 'EntityViewSwitcher.tsx'));
    expect(switcher).toMatch(/import \{ SegmentedControl \} from '\.\/SegmentedControl\.js'/);
    expect(switcher).not.toMatch(/SegmentedControlTabs\s*[,}]/);
    expect(switcher.match(DEBT_MARKER)?.[0]).toContain('2.1.20');
    expect(readSource(kit(pkg, 'SegmentedControl.tsx'))).toMatch(/from '\.\/ButtonGroup\.js'/);
    expect(readSource(kit(pkg, 'EntityBreadcrumbBar.tsx'))).toMatch(/<EntityViewSwitcher\b/);
  });

  it(`[section:${section}] ListPageLayout and RoutePane are new debts with no catalog replacement`, () => {
    assertTrajectoryDebts(section, pkg);
  });

  it(`[section:${section}] ListPageHeader, ListScrollArea and MethodChip are struck: not declared, and MethodChip only binds the catalog Badge`, () => {
    assertStruck(section, ['ListPageHeader', 'ListScrollArea', 'MethodChip']);
    const atoms = readSource(kit(pkg, 'atoms.tsx'));
    const header = atoms.match(DEBT_MARKER);
    expect(header).not.toBeNull();
    const debtText = atoms.slice(0, atoms.indexOf('Recorded, not fixed here'));
    expect(debtText).toContain('`TagChip`');
    expect(debtText).not.toContain('`MethodChip`');
    expect(ownsMarkup(kit(pkg, 'atoms.tsx'))).toBe(false);
    expect(atoms).toMatch(/export function MethodChip[\s\S]*?<Badge\b/);
  });
}

describe('[section:9hz21ysc] dto Host UI Kit slice', () => {
  apiContractsCase('9hz21ysc', 'dto');
});

describe('[section:dhh869qt] endpoint Host UI Kit slice', () => {
  apiContractsCase('dhh869qt', 'endpoint');
});

/** The local list composition of `frontend-mockups` — catalog components only. */
function assertListCompositionIsCatalogOnly(): void {
  const pkg = 'c4s-plugin-frontend-mockups';
  for (const name of ['ListPageHeader', 'ListScrollArea']) {
    const file = kit(pkg, `${name}.tsx`);
    const src = readSource(file);
    expect(ownsMarkup(file), `${name} owns no markup`).toBe(false);
    expect(src, `${name} carries no DEBT header`).not.toMatch(DEBT_MARKER);
    expect(scanFindings().filter((f) => f.file === file)).toEqual([]);
    expect(src).toMatch(/<ActionButton\b/);
  }
  expect(readSource(kit(pkg, 'ListPageHeader.tsx'))).toMatch(/<EntityListHeader\b/);
  const area = readSource(kit(pkg, 'ListScrollArea.tsx'));
  for (const c of ['EntityListLayout', 'LoadingState', 'EmptyState']) expect(area).toMatch(new RegExp(`<${c}\\b`));
}

describe('[section:mq3b803z] design-system Host UI Kit slice', () => {
  it('[section:mq3b803z] the check reads the design-system entries — the local token components and screen roots, and the DŁUG EntityBreadcrumbBar, EntityNotFound, popover form, ListPageLayout, RoutePane', () => {
    expect(entries('mq3b803z')).toEqual([
      {
        kind: 'local',
        components: ['TokenGroupEditor', 'DesignSystemPreview', 'ColorSwatchGrid', 'TypographySpecimen', 'ScaleStrip', 'ModeSwitcher'],
        replacedBy: [],
      },
      { kind: 'local', components: ['DesignSystemsList', 'DesignSystemDetail'], replacedBy: [] },
      debt(['EntityBreadcrumbBar'], ['DetailPanelShell']),
      debt(['EntityNotFound'], ['EmptyState']),
      debt(POPOVER_FORM, ['FormField']),
      debt(['ListPageLayout']),
      debt(['RoutePane']),
    ]);
  });

  it('[section:mq3b803z] the list composes EntityListHeader, EntityListLayout, LoadingState and EmptyState in ListPageHeader / ListScrollArea — catalog components only, not host-local', () => {
    assertStruck('mq3b803z', ['ListPageHeader', 'ListScrollArea', 'EntityViewSwitcher']);
    assertListCompositionIsCatalogOnly();
    const list = readSource('plugins/c4s-plugin-frontend-mockups/src/entity/design-system/frontend/list-page.tsx');
    expect(list).toMatch(/<ListPageHeader\b/);
    expect(list).toMatch(/<ListScrollArea\b/);
    expect(list).not.toMatch(DEBT_MARKER);
  });

  it('[section:mq3b803z] ListPageLayout and RoutePane are new debts with no catalog replacement', () => {
    assertTrajectoryDebts('mq3b803z', 'c4s-plugin-frontend-mockups');
  });
});

describe('[section:yn1fk80a] ui-view Host UI Kit slice', () => {
  it('[section:yn1fk80a] the check reads the ui-view DŁUG entries — EntityBreadcrumbBar, EntityNotFound, CountBadge, the popover form, ListPageLayout, RoutePane', () => {
    expect(entries('yn1fk80a')).toEqual([
      debt(['EntityBreadcrumbBar'], ['DetailPanelShell']),
      debt(['EntityNotFound'], ['EmptyState']),
      debt(['CountBadge'], ['Badge']),
      debt(POPOVER_FORM, ['FormField']),
      debt(['ListPageLayout']),
      debt(['RoutePane']),
    ]);
  });

  it('[section:yn1fk80a] the tab switcher wrapper EntityViewSwitcher is a composition of SegmentedControlTabs only — not declared, no own markup, no DEBT header', () => {
    assertStruck('yn1fk80a', ['ListPageHeader', 'ListScrollArea', 'EntityViewSwitcher']);
    const file = kit('c4s-plugin-frontend-mockups', 'EntityViewSwitcher.tsx');
    expect(ownsMarkup(file)).toBe(false);
    expect(readSource(file)).not.toMatch(DEBT_MARKER);
    expect(readSource(file)).toMatch(/<SegmentedControlTabs\b/);
  });

  it('[section:yn1fk80a] ListPageHeader / ListScrollArea are catalog-only compositions, and ListPageLayout / RoutePane are new debts with no catalog replacement', () => {
    assertListCompositionIsCatalogOnly();
    assertTrajectoryDebts('yn1fk80a', 'c4s-plugin-frontend-mockups');
  });
});

describe('[section:lg0e57j1] c4s-plugin-spreadsheets Host UI Kit slice', () => {
  const pkg = 'c4s-plugin-spreadsheets';

  it('[section:lg0e57j1] the check reads two entries — SpreadsheetFullscreen as local, the popover form as DŁUG replaced by FormField', () => {
    expect(entries('lg0e57j1')).toEqual([
      { kind: 'local', components: ['SpreadsheetFullscreen'], replacedBy: [] },
      debt(POPOVER_FORM, ['FormField']),
    ]);
  });

  it('[section:lg0e57j1] the package consumes no catalog component — nothing in it imports @c4s/plugin-runtime/ui', () => {
    const files = envelopeFiles().filter((f) => f.startsWith(`plugins/${pkg}/src/`));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readSource(f), f).not.toMatch(/@c4s\/plugin-runtime\/ui/);
  });

  it('[section:lg0e57j1] the fullscreen overlay is a finding only the local entry excuses, and the popover form copy carries its DEBT header', () => {
    const fullscreen = 'plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/frontend/node-view.tsx';
    expect(readSource(fullscreen)).toMatch(/export const SpreadsheetFullscreen\b/);
    expect(violationsWithout('lg0e57j1', fullscreen)).toEqual([{ file: fullscreen, detector: 'anatomy:Dialog' }]);
    const form = kit(pkg, 'popover-form.tsx');
    expect(readSource(form).match(DEBT_MARKER)?.[0]).toContain(pkg);
    for (const n of POPOVER_FORM) expect(readSource(form)).toMatch(new RegExp(`export (const|function) ${n}\\b`));
  });
});
