/**
 * M34/L12 — the `Host-local components` fields of the L12 consumers, as data.
 *
 * Gate (a) of the catalog qualification rule (M34 `hntah0r7`) is checked
 * automatically over the host code and the sources of every envelope
 * (`ui-kit-gate.ts`). The check has NO exception list of its own: a file that
 * renders anatomy the catalog owns passes only when a declaration below names
 * it. Each declaration mirrors one entry of a consumer's `## Host UI Kit (L12)`
 * section as it stands at the release, keyed by that section's anchor — so the
 * declarations and the check read one list and cannot drift apart. Adding an
 * exception means adding the entry to the specification first.
 *
 * Three kinds, as the slice schema (`l12slice0`) names them:
 * - `debt` — a **DŁUG** entry: markup that fails a locality condition, recorded
 *   and tolerated until it is migrated (`replacedBy` = the catalog replacement
 *   the entry names; empty when the catalog has none yet and the entry is a
 *   catalog-trajectory candidate, M34 `m34traj0`). Its files carry a
 *   `DEBT (…, Host UI Kit …)` header — the check holds both sides equal.
 * - `host-internal` — a **KOMPONENT WEWNĘTRZNY HOSTA**: one implementation,
 *   unpublished to plugins, duplicating no catalog anatomy. Its files carry a
 *   `HOST-INTERNAL COMPONENT` header.
 * - `local` — a component that meets both locality conditions (gate (b)).
 *
 * `files` are repo-relative paths of the sources where the declared markup
 * lives. Entries shared by two consumers (one package carrying two types) are
 * declared once per consumer section, as the specification does.
 */

export type HostLocalKind = 'debt' | 'host-internal' | 'local';

export interface HostLocalDeclaration {
  /** Anchor of the consumer's `## Host UI Kit (L12)` section that declares the entry. */
  section: string;
  /** The consumer: a host module (`M17`) or an envelope type / package. */
  consumer: string;
  kind: HostLocalKind;
  /** Component names exactly as the entry names them. */
  components: readonly string[];
  /** Catalog replacement(s) the entry names (debt only; empty = no catalog component yet). */
  replacedBy: readonly string[];
  /** Repo-relative source files holding the declared markup. */
  files: readonly string[];
}

/** The popover form every DŁUG entry of that name covers (five packages carry a copy). */
const POPOVER_FORM = ['FieldLabel', 'TextInput', 'SelectInput', 'InlineError', 'PopoverFooter'] as const;

/**
 * The popover form's files in one package: the form fields and — ASSUMPTION:dev-2007 —
 * the `SlashPopoverShell` frame the form sits in (`slash-create.tsx`), which the
 * entry does not name but which is the popover of the "popover form".
 */
const popoverFormFiles = (pkg: string): string[] => [
  `plugins/${pkg}/src/frontend-kit/popover-form.tsx`,
  `plugins/${pkg}/src/frontend-kit/slash-create.tsx`,
];

const kit = (pkg: string, file: string): string => `plugins/${pkg}/src/frontend-kit/${file}`;

/** `ListPageLayout` and `RoutePane` — the two 2.1.20 debts without a catalog replacement. */
function trajectoryDebts(section: string, consumer: string, pkg: string, withListLayout = true): HostLocalDeclaration[] {
  return [
    ...(withListLayout
      ? [
          {
            section,
            consumer,
            kind: 'debt' as const,
            components: ['ListPageLayout'],
            replacedBy: [],
            files: [kit(pkg, 'ListPageLayout.tsx')],
          },
        ]
      : []),
    {
      section,
      consumer,
      kind: 'debt',
      // The package's copy of the host's `RoutePane` — exported as `Pane` from `route-shell`.
      components: ['RoutePane'],
      replacedBy: [],
      files: [kit(pkg, 'route-shell.tsx')],
    },
  ];
}

function apiContractsDeclarations(section: string, consumer: string): HostLocalDeclaration[] {
  const pkg = 'c4s-plugin-api-contracts';
  return [
    { section, consumer, kind: 'debt', components: ['EntityBreadcrumbBar'], replacedBy: ['DetailPanelShell'], files: [kit(pkg, 'EntityBreadcrumbBar.tsx')] },
    { section, consumer, kind: 'debt', components: ['EntityViewSwitcher'], replacedBy: ['SegmentedControlTabs'], files: [kit(pkg, 'EntityViewSwitcher.tsx')] },
    { section, consumer, kind: 'debt', components: ['SegmentedControl'], replacedBy: ['SegmentedControlTabs'], files: [kit(pkg, 'SegmentedControl.tsx')] },
    { section, consumer, kind: 'debt', components: ['ButtonGroup', 'SegmentButton'], replacedBy: ['SegmentedControlTabs'], files: [kit(pkg, 'ButtonGroup.tsx')] },
    // 2.1.39: the local `TagChip` debt is gone — the catalog's own `TagChip` replaces it.
    { section, consumer, kind: 'debt', components: [...POPOVER_FORM], replacedBy: ['FormField'], files: popoverFormFiles(pkg) },
    ...trajectoryDebts(section, consumer, pkg),
  ];
}

function frontendMockupsDebts(section: string, consumer: string, extra: HostLocalDeclaration[] = []): HostLocalDeclaration[] {
  const pkg = 'c4s-plugin-frontend-mockups';
  return [
    { section, consumer, kind: 'debt', components: ['EntityBreadcrumbBar'], replacedBy: ['DetailPanelShell'], files: [kit(pkg, 'EntityBreadcrumbBar.tsx')] },
    { section, consumer, kind: 'debt', components: ['EntityNotFound'], replacedBy: ['EmptyState'], files: [kit(pkg, 'EntityNotFound.tsx')] },
    ...extra,
    { section, consumer, kind: 'debt', components: [...POPOVER_FORM], replacedBy: ['FormField'], files: popoverFormFiles(pkg) },
    ...trajectoryDebts(section, consumer, pkg),
  ];
}

export const HOST_LOCAL_DECLARATIONS: readonly HostLocalDeclaration[] = [
  // ── Host modules ────────────────────────────────────────────────────────────
  // M10 `0dy3js11` — two DŁUG entries on plan-page; both fail locality
  // condition (1), each also stands on other pages.
  {
    section: '0dy3js11',
    consumer: 'M10',
    kind: 'debt',
    // "Panel wątków" — shared with brief-page; no catalog component replaces it
    // yet, its successor is the trajectory candidate `artifact-thread-list`.
    components: ['ArtifactThreadsPanel'],
    replacedBy: [],
    files: ['src/client/components/ArtifactThreadsPanel.tsx'],
  },
  {
    section: '0dy3js11',
    consumer: 'M10',
    kind: 'debt',
    components: ['FileVersionHistory'],
    replacedBy: ['VersionHistory'],
    files: ['src/client/components/FileVersionHistory.tsx'],
  },
  // M17 `v05js8rl`
  {
    section: 'v05js8rl',
    consumer: 'M17',
    kind: 'debt',
    components: ['CreateReleaseDialog'],
    replacedBy: ['Dialog'],
    files: ['src/client/components/CreateReleaseDialog.tsx'],
  },
  // M21 `q856s1vm`
  {
    section: 'q856s1vm',
    consumer: 'M21',
    kind: 'debt',
    components: ['CreateBriefDialog'],
    replacedBy: ['Dialog'],
    files: ['src/client/components/CreateBriefDialog.tsx'],
  },
  {
    section: 'q856s1vm',
    consumer: 'M21',
    kind: 'debt',
    components: ['SegmentedControl'],
    replacedBy: ['SegmentedControlTabs'],
    files: ['src/client/components/SegmentedControl.tsx'],
  },
  {
    section: 'q856s1vm',
    consumer: 'M21',
    kind: 'debt',
    components: ['FileVersionHistory'],
    replacedBy: ['VersionHistory', 'DiffView'],
    files: ['src/client/components/FileVersionHistory.tsx'],
  },
  // M31 `j6b1z37u`
  {
    section: 'j6b1z37u',
    consumer: 'M31',
    kind: 'debt',
    components: ['ProjectCreate'],
    replacedBy: ['Dialog'],
    files: ['src/client/ui/modals/ProjectCreate.tsx'],
  },
  {
    section: 'j6b1z37u',
    consumer: 'M31',
    kind: 'host-internal',
    components: ['DirectoryPickerModal'],
    replacedBy: [],
    files: ['src/client/components/DirectoryPickerModal.tsx'],
  },

  // ── Envelopes ───────────────────────────────────────────────────────────────
  // c4s-plugin-ac `yrzqclyz`
  { section: 'yrzqclyz', consumer: 'c4s-plugin-ac', kind: 'debt', components: ['EntityBreadcrumbBar'], replacedBy: ['DetailPanelShell'], files: [kit('c4s-plugin-ac', 'EntityBreadcrumbBar.tsx')] },
  { section: 'yrzqclyz', consumer: 'c4s-plugin-ac', kind: 'debt', components: ['EntityNotFound'], replacedBy: ['EmptyState'], files: [kit('c4s-plugin-ac', 'EntityNotFound.tsx')] },
  { section: 'yrzqclyz', consumer: 'c4s-plugin-ac', kind: 'debt', components: [...POPOVER_FORM], replacedBy: ['FormField'], files: popoverFormFiles('c4s-plugin-ac') },
  ...trajectoryDebts('yrzqclyz', 'c4s-plugin-ac', 'c4s-plugin-ac'),

  // dto `9hz21ysc`, endpoint `dhh869qt` — one package, the same entries twice.
  ...apiContractsDeclarations('9hz21ysc', 'dto'),
  ...apiContractsDeclarations('dhh869qt', 'endpoint'),

  // design-system `mq3b803z`
  {
    section: 'mq3b803z',
    consumer: 'design-system',
    kind: 'local',
    components: ['TokenGroupEditor', 'DesignSystemPreview', 'ColorSwatchGrid', 'TypographySpecimen', 'ScaleStrip', 'ModeSwitcher'],
    replacedBy: [],
    files: ['plugins/c4s-plugin-frontend-mockups/src/entity/design-system/frontend/detail-panel.tsx'],
  },
  {
    section: 'mq3b803z',
    consumer: 'design-system',
    kind: 'local',
    components: ['DesignSystemsList', 'DesignSystemDetail'],
    replacedBy: [],
    files: [
      'plugins/c4s-plugin-frontend-mockups/src/entity/design-system/frontend/list-page.tsx',
      'plugins/c4s-plugin-frontend-mockups/src/entity/design-system/frontend/detail-panel.tsx',
    ],
  },
  ...frontendMockupsDebts('mq3b803z', 'design-system'),

  // ui-view `yn1fk80a`
  {
    section: 'yn1fk80a',
    consumer: 'ui-view',
    kind: 'local',
    // "ramka podglądu makiety" — the bare sandboxed `<iframe>` of the preview tab
    // (the entry names no component; this is its code name).
    components: ['UiViewPreview'],
    replacedBy: [],
    files: ['plugins/c4s-plugin-frontend-mockups/src/entity/ui-view/frontend/preview-page.tsx'],
  },
  ...frontendMockupsDebts('yn1fk80a', 'ui-view', [
    {
      section: 'yn1fk80a',
      consumer: 'ui-view',
      kind: 'debt',
      components: ['CountBadge'],
      replacedBy: ['Badge'],
      files: [kit('c4s-plugin-frontend-mockups', 'EntityListRow.tsx')],
    },
  ]),

  // c4s-plugin-spreadsheets `lg0e57j1`
  {
    section: 'lg0e57j1',
    consumer: 'c4s-plugin-spreadsheets',
    kind: 'debt',
    // The fullscreen shell; no catalog replacement yet — trajectory candidate `fullscreen-overlay`.
    components: ['SpreadsheetFullscreen'],
    replacedBy: [],
    files: ['plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/frontend/node-view.tsx'],
  },
  { section: 'lg0e57j1', consumer: 'c4s-plugin-spreadsheets', kind: 'debt', components: [...POPOVER_FORM], replacedBy: ['FormField'], files: popoverFormFiles('c4s-plugin-spreadsheets') },

  // ── Further envelope consumers ──────────────────────────────────────────────
  // Mirrored because the check covers their sources too.
  // c4s-plugin-database-tables `uyu88bdw`
  { section: 'uyu88bdw', consumer: 'c4s-plugin-database-tables', kind: 'debt', components: [...POPOVER_FORM], replacedBy: ['FormField'], files: popoverFormFiles('c4s-plugin-database-tables') },
  {
    section: 'uyu88bdw',
    consumer: 'c4s-plugin-database-tables',
    kind: 'local',
    // "edytor siatki kolumn" / "edytor siatki indeksów"
    components: ['ColumnsEditor', 'IndexesEditor'],
    replacedBy: [],
    files: ['plugins/c4s-plugin-database-tables/src/entity/database-table/frontend/detail-panel.tsx'],
  },
  // c4s-plugin-host-ui-kit-components `pv2psgi6` — three LOCAL tables of the type's detail
  {
    section: 'pv2psgi6',
    consumer: 'c4s-plugin-host-ui-kit-components',
    kind: 'local',
    components: ['PropsTable', 'TypesTable', 'DataSourcesTable'],
    replacedBy: [],
    files: ['plugins/c4s-plugin-host-ui-kit-components/src/entity/ui-kit-component/frontend/detail-panel.tsx'],
  },
  // c4s-plugin-code-snippets `jsejrh30`
  {
    section: 'jsejrh30',
    consumer: 'c4s-plugin-code-snippets',
    kind: 'local',
    components: ['CodeSnippetView'],
    replacedBy: [],
    files: ['plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/view.tsx'],
  },
  {
    section: 'jsejrh30',
    consumer: 'c4s-plugin-code-snippets',
    kind: 'debt',
    // The fullscreen shell; no catalog replacement yet — trajectory candidate `fullscreen-overlay`.
    components: ['CodeSnippetFullscreen'],
    replacedBy: [],
    files: ['plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/fullscreen.tsx'],
  },
  {
    section: 'jsejrh30',
    consumer: 'c4s-plugin-code-snippets',
    kind: 'local',
    // The create/edit window form; ASSUMPTION:dev-2007 — with the `SlashPopoverShell` frame it sits in.
    // ASSUMPTION:dev-2806 — the 2.1.28 entry no longer lists it, but its frame is a
    // gate finding (scrim twin + own kit markup), so the declaration stays (`31369549`).
    components: ['CodeSnippetPopover'],
    replacedBy: [],
    files: [
      'plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/popover.tsx',
      'plugins/c4s-plugin-code-snippets/src/frontend-kit/slash-create.tsx',
    ],
  },
  // 2.1.63 — no `diagram` (`rgczgux0`) declarations: the type's UI ships in the
  // prebuilt `diagrams` envelope, outside the files this gate scans.
];

/** The declarations one consumer section makes. */
export function declarationsOf(section: string): HostLocalDeclaration[] {
  return HOST_LOCAL_DECLARATIONS.filter((d) => d.section === section);
}
