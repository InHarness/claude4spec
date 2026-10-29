/**
 * 2.1.26 (M33 `m33load01`, L11 "Plugin manifest" of every type package) — the
 * `displayOrder` field is retired from the type identity. Every package page's
 * manifest block drops its `displayOrder: N` line (and the hidden types drop
 * the "no consumer" comment that stood in for it); the (since 2.1.50: default)
 * order of the ELEMENTS entries comes from the frontend module's
 * `sidebarTab.order`, and a type without a tab declares no order at all.
 *
 * Per type, three things are checked:
 *   - the contribution the package's manifest exports carries no `displayOrder`
 *     key, and the host's lowering (the registration door, which refuses an
 *     unknown key) accepts it and produces a module without one;
 *   - no source of the package — contribution, identity constants, frontend
 *     module — still declares a `displayOrder` field or a `*_DISPLAY_ORDER`
 *     constant;
 *   - a visible type orders itself through `sidebarTab.order`; a hidden type's
 *     frontend module declares neither a tab nor any `order`.
 *
 * `diagram` is not here since 2.1.63: it ships in the prebuilt `diagrams`
 * envelope, whose declarations are the `diagrams` project's.
 *
 * Lives under `tests/` because it imports the envelopes' own sources next to
 * the host's, which no single envelope config compiles together.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { lowerEntityContribution } from '../../../src/server/core/plugin-host/manifest-adapter.js';
import type { EntityContribution } from '../../../src/shared/plugin-host/manifest.js';
import { manifest as acManifest } from '../../../plugins/c4s-plugin-ac/src/manifest.js';
import { manifest as apiContractsManifest } from '../../../plugins/c4s-plugin-api-contracts/src/manifest.js';
import { manifest as codeSnippetsManifest } from '../../../plugins/c4s-plugin-code-snippets/src/manifest.js';
import { manifest as databaseTablesManifest } from '../../../plugins/c4s-plugin-database-tables/src/manifest.js';
import { manifest as frontendMockupsManifest } from '../../../plugins/c4s-plugin-frontend-mockups/src/manifest.js';
import { manifest as lvsManifest } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/manifest.js';
import { manifest as spreadsheetsManifest } from '../../../plugins/c4s-plugin-spreadsheets/src/manifest.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const codeOf = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

/** Source with comments stripped — a retirement note may NAME the field; code may not declare it. */
const declarations = (rel: string) =>
  codeOf(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

type Manifest = { contributes?: { entities?: unknown[] } };

function contributionOf(manifest: Manifest, type: string): EntityContribution {
  const c = (manifest.contributes?.entities ?? []).find(
    (e) => (e as { type?: string }).type === type,
  ) as EntityContribution | undefined;
  if (!c) throw new Error(`no contribution for ${type}`);
  return c;
}

interface Case {
  type: string;
  manifest: Manifest;
  /** The package's identity constants file. */
  identity: string;
  /** The file that declares the type contribution. */
  contribution: string;
  /** The file that declares the type's frontend module. */
  frontend: string;
}

function expectIdentityWithoutDisplayOrder(c: Case): void {
  const contribution = contributionOf(c.manifest, c.type);
  expect('displayOrder' in contribution, `${c.type} contribution carries displayOrder`).toBe(false);
  // The registration door refuses an unknown key, so lowering the real
  // contribution proves the package is admitted without the field.
  const lowered = lowerEntityContribution(contribution) as unknown as Record<string, unknown>;
  expect(lowered.type).toBe(c.type);
  expect('displayOrder' in lowered).toBe(false);
  for (const file of [c.contribution, c.identity, c.frontend]) {
    const code = declarations(file);
    expect(code, `${file} declares displayOrder`).not.toMatch(/\bdisplayOrder\b/);
    expect(code, `${file} declares a *_DISPLAY_ORDER constant`).not.toMatch(/_DISPLAY_ORDER\b/);
  }
}

/** A visible type: its frontend module's `sidebarTab` carries the `order`. */
function expectOrderedBySidebarTab(c: Case): void {
  const code = declarations(c.frontend);
  expect(code).toMatch(/sidebarTab:\s*\{[^}]*\border:/);
}

/** A hidden type: no tab, and so no order of any kind on its frontend module. */
function expectNoOrderAtAll(c: Case): void {
  const code = declarations(c.frontend);
  expect(code).not.toMatch(/\bsidebarTab\s*:/);
  expect(code).not.toMatch(/\border\s*:/);
}

const AC: Case = {
  type: 'ac',
  manifest: acManifest as Manifest,
  identity: 'plugins/c4s-plugin-ac/src/identity.ts',
  contribution: 'plugins/c4s-plugin-ac/src/entity/ac/index.ts',
  frontend: 'plugins/c4s-plugin-ac/src/entity/ac/frontend/module.tsx',
};
const DTO: Case = {
  type: 'dto',
  manifest: apiContractsManifest as Manifest,
  identity: 'plugins/c4s-plugin-api-contracts/src/identity.ts',
  contribution: 'plugins/c4s-plugin-api-contracts/src/entity/dto/index.ts',
  frontend: 'plugins/c4s-plugin-api-contracts/src/entity/dto/frontend/module.tsx',
};
const ENDPOINT: Case = {
  type: 'endpoint',
  manifest: apiContractsManifest as Manifest,
  identity: 'plugins/c4s-plugin-api-contracts/src/identity.ts',
  contribution: 'plugins/c4s-plugin-api-contracts/src/entity/endpoint/index.ts',
  frontend: 'plugins/c4s-plugin-api-contracts/src/entity/endpoint/frontend/module.tsx',
};
const CODE_SNIPPET: Case = {
  type: 'code-snippet',
  manifest: codeSnippetsManifest as Manifest,
  identity: 'plugins/c4s-plugin-code-snippets/src/identity.ts',
  contribution: 'plugins/c4s-plugin-code-snippets/src/entity/code-snippet/index.ts',
  frontend: 'plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/module.tsx',
};
const DATABASE_TABLE: Case = {
  type: 'database-table',
  manifest: databaseTablesManifest as Manifest,
  identity: 'plugins/c4s-plugin-database-tables/src/identity.ts',
  contribution: 'plugins/c4s-plugin-database-tables/src/entity/database-table/index.ts',
  frontend: 'plugins/c4s-plugin-database-tables/src/entity/database-table/frontend/module.tsx',
};
const DESIGN_SYSTEM: Case = {
  type: 'design-system',
  manifest: frontendMockupsManifest as Manifest,
  identity: 'plugins/c4s-plugin-frontend-mockups/src/identity.ts',
  contribution: 'plugins/c4s-plugin-frontend-mockups/src/entity/design-system/index.ts',
  frontend: 'plugins/c4s-plugin-frontend-mockups/src/entity/design-system/frontend/module.tsx',
};
const UI_VIEW: Case = {
  type: 'ui-view',
  manifest: frontendMockupsManifest as Manifest,
  identity: 'plugins/c4s-plugin-frontend-mockups/src/identity.ts',
  contribution: 'plugins/c4s-plugin-frontend-mockups/src/entity/ui-view/index.ts',
  frontend: 'plugins/c4s-plugin-frontend-mockups/src/entity/ui-view/frontend/module.tsx',
};
const MODULE_DEPENDENCY: Case = {
  type: 'module-dependency',
  manifest: lvsManifest as Manifest,
  identity: 'plugins/c4s-plugin-layered-vertical-slices/src/entity/module-dependency/identity.ts',
  contribution: 'plugins/c4s-plugin-layered-vertical-slices/src/entity/module-dependency/index.ts',
  frontend: 'plugins/c4s-plugin-layered-vertical-slices/src/entity/module-dependency/frontend/module.tsx',
};
const SPREADSHEET: Case = {
  type: 'spreadsheet',
  manifest: spreadsheetsManifest as Manifest,
  identity: 'plugins/c4s-plugin-spreadsheets/src/identity.ts',
  contribution: 'plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/index.ts',
  frontend: 'plugins/c4s-plugin-spreadsheets/src/entity/spreadsheet/frontend/module.tsx',
};

describe('2.1.26 — displayOrder retired from every type package manifest', () => {
  it('[section:fsu38c8q] ac: the manifest declares no displayOrder; the ELEMENTS order is the frontend module\'s sidebarTab.order', () => {
    expectIdentityWithoutDisplayOrder(AC);
    expectOrderedBySidebarTab(AC);
  });

  it('[section:xvm9aann] dto: the manifest declares no displayOrder; the ELEMENTS order is the frontend module\'s sidebarTab.order', () => {
    expectIdentityWithoutDisplayOrder(DTO);
    expectOrderedBySidebarTab(DTO);
  });

  it('[section:vc5pzsc0] endpoint: the manifest declares no displayOrder; the ELEMENTS order is the frontend module\'s sidebarTab.order', () => {
    expectIdentityWithoutDisplayOrder(ENDPOINT);
    expectOrderedBySidebarTab(ENDPOINT);
  });

  it('[section:n6zlyrol] code-snippet: the manifest declares no displayOrder and, being hidden, no order at all', () => {
    expectIdentityWithoutDisplayOrder(CODE_SNIPPET);
    expectNoOrderAtAll(CODE_SNIPPET);
  });

  it('[section:ityp8g1r] database-table: the manifest declares no displayOrder; the ELEMENTS order is the frontend module\'s sidebarTab.order', () => {
    expectIdentityWithoutDisplayOrder(DATABASE_TABLE);
    expectOrderedBySidebarTab(DATABASE_TABLE);
  });

  it('[section:dsmanifest] design-system: the manifest declares no displayOrder; the ELEMENTS order is the frontend module\'s sidebarTab.order', () => {
    expectIdentityWithoutDisplayOrder(DESIGN_SYSTEM);
    expectOrderedBySidebarTab(DESIGN_SYSTEM);
  });

  it('[section:cv8b7alf] ui-view: the manifest declares no displayOrder; the ELEMENTS order is the frontend module\'s sidebarTab.order', () => {
    expectIdentityWithoutDisplayOrder(UI_VIEW);
    expectOrderedBySidebarTab(UI_VIEW);
  });

  it('[section:04i1idm7] module-dependency: the manifest declares no displayOrder and, being hidden, no order at all', () => {
    expectIdentityWithoutDisplayOrder(MODULE_DEPENDENCY);
    expectNoOrderAtAll(MODULE_DEPENDENCY);
  });

  it('[section:fbgmkqw7] spreadsheet: the manifest declares no displayOrder and, being hidden, no order at all', () => {
    expectIdentityWithoutDisplayOrder(SPREADSHEET);
    expectNoOrderAtAll(SPREADSHEET);
  });
});
