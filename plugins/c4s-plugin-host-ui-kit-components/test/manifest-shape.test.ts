/**
 * The envelope's manifest (c4s-plugin-host-ui-kit-components `vc51375k`,
 * `spf7qirh`; the `encje-pluginy` row of the package).
 */

import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { uiKitComponentEntity } from '../src/entity/ui-kit-component/index.js';
import { uiKitComponentData } from '../src/entity/ui-kit-component/schema.js';

describe('c4s-plugin-host-ui-kit-components manifest', () => {
  it('[entity:encje-pluginy#c4s-plugin-host-ui-kit-components] the package manifest declares the ui-kit-component entity type, with the ui-kit-component-tools server as its only backend slot', () => {
    expect(manifest.name).toBe('c4s-plugin-host-ui-kit-components');
    expect(manifest.hostApiVersion).toBe('^2.1.0');
    expect(manifest.contributes?.entities?.map((e) => e.type)).toEqual(['ui-kit-component']);
    expect(manifest.contributes?.entities?.[0]).toBe(uiKitComponentEntity);
    // One `contributes.entities[]` entry and nothing else.
    expect(Object.keys(manifest.contributes ?? {})).toEqual(['entities']);
    // Identity and the generated CRUD prefix (mounted under /api by the host).
    expect(uiKitComponentEntity.label).toBeTruthy();
    expect(uiKitComponentEntity.pathPrefix).toBe('/ui-kit-components');
    // Backend: only `mcpServer`, no `routes` / `service`.
    expect(Object.keys(uiKitComponentEntity.backend ?? {})).toEqual(['mcpServer']);
    expect(uiKitComponentEntity.systemPrompt?.mcpToolsLine).toBe('ui-kit-component-tools: audit_ui_kit_components');
    expect((uiKitComponentEntity.systemPrompt as { defaultPredicate?: unknown }).defaultPredicate).toBeUndefined();
  });

  it('[section:8kvfhgsj] the logical schema: four required fields, four collections, three optional fields and the reserved title', () => {
    const s = uiKitComponentData.schema as unknown as Record<string, Record<string, unknown>>;
    expect(s.title).toMatchObject({ type: 'string', required: true, maxLength: 200 });
    expect(s.name).toMatchObject({ type: 'string', required: true, maxLength: 100, kind: 'non-empty' });
    expect(s.group).toMatchObject({
      type: 'enum',
      required: true,
      values: ['core', 'list', 'actions', 'form', 'overlay', 'detail', 'feedback', 'pickers'],
    });
    expect(s.stability).toMatchObject({ type: 'enum', required: true, values: ['stable', 'experimental'] });
    for (const c of ['props', 'types', 'dataSources', 'composes']) expect(s[c]?.type).toBe('collection');
    expect((s.composes!.item as { fields: Record<string, unknown> }).fields.component).toMatchObject({
      ref: 'ui-kit-component',
      onMissing: 'warn',
      onDelete: 'leave-dangling',
    });
    expect(s.soleAnatomyOf).toMatchObject({ type: 'string', maxLength: 100 });
    expect(s.behavior).toMatchObject({ type: 'string', maxLength: 20000 });
    expect(s.anatomy).toMatchObject({ type: 'string', contentBearing: true });
  });

  it('[ac:ac-kazdy-wpis-katalogu-host-ui-kit-deklaruj] binding is a required enum of exactly presentational | connected, with no default to fall back on', () => {
    const binding = (uiKitComponentData.schema as unknown as Record<string, Record<string, unknown>>).binding!;
    expect(binding).toMatchObject({ type: 'enum', required: true, values: ['presentational', 'connected'] });
    expect(binding).not.toHaveProperty('default');
    expect(binding).not.toHaveProperty('computedDefault');
  });

  it('[ac:ac-komponent-o-binding-connected-jawni] dataSources entries carry the consumed export and a usage of fetchedByComponent | feedsProps', () => {
    const ds = (uiKitComponentData.schema as unknown as Record<string, Record<string, unknown>>).dataSources!;
    const fields = (ds.item as { fields: Record<string, Record<string, unknown>> }).fields;
    expect(fields.export).toMatchObject({ type: 'string', required: true });
    expect(fields.usage).toMatchObject({ type: 'enum', required: true, values: ['fetchedByComponent', 'feedsProps'] });
  });
});
