/**
 * 2.1.20 — the `@c4s/plugin-runtime` names each consumer module of L11 carries
 * (M13 `m13l11sc`, M05 `m05l11sc`, M18 `mn59j0le`, M20 `m20l11sc`, M39
 * `gz7q92lz`): every name sits on the leg its section gives it, its row of the
 * leg inventory (M33 `m33rt001`) points back at that section, the leg really
 * serves it (the import-map shim for the browser, the Node barrel for the
 * backend), the per-leg ambient types it for that leg only, and the published
 * type surface declares it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as backendLeg from './index.js';
import { getRuntimeShim } from '../core/plugin-host/runtime-shims.js';
import { PLUGIN_RUNTIME_LEGS, pluginRuntimeLegOf } from '../../shared/plugin-host/runtime-legs.js';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
import { DomainError } from '../services/tags.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const published = read('../../plugin-types/plugin-runtime.ts');

/** Value names a per-leg ambient file re-exports on `@c4s/plugin-runtime`. */
function ambientValues(rel: string): string[] {
  const text = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /declare module '@c4s\/plugin-runtime' \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';
  return [...block.matchAll(/export \{([^}]*)\} from/g)].flatMap((m) =>
    m[1]!.split(',').map((n) => n.trim()).filter(Boolean),
  );
}
const browserAmbient = ambientValues('../../plugin-types/ambient.d.ts');
const backendAmbient = ambientValues('../../plugin-types/ambient-backend.d.ts');

let shimNames: string[] | null = null;
async function browserShim(): Promise<string[]> {
  if (!shimNames) {
    const shim = (await getRuntimeShim('plugin-runtime'))!;
    shimNames = [...shim.matchAll(/^export const ([A-Za-z_$][\w$]*) =/gm)].map((m) => m[1]!);
  }
  return shimNames;
}

/** The published surface declares `name` as a value. */
const declaresValue = (name: string) =>
  new RegExp(`export declare (?:const|function|class) ${name}\\b`).test(published) ||
  new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from`).test(published);
/** The published surface declares `name` as a type. */
const declaresType = (name: string) =>
  new RegExp(`export (?:interface|type) ${name}\\b`).test(published) ||
  new RegExp(`export type \\{[^}]*\\b${name}\\b[^}]*\\}`).test(published);

/** Assert one module's names: leg, owner row, the leg serving it, its ambient leg, its declaration. */
async function assertCarried(module: string, anchor: string, names: { browser?: string[]; backend?: string[]; types?: string[] }) {
  const shim = await browserShim();
  for (const [leg, list] of [['browser', names.browser ?? []], ['backend', names.backend ?? []]] as const) {
    for (const name of list) {
      expect(pluginRuntimeLegOf(name), name).toBe(leg);
      const row = PLUGIN_RUNTIME_LEGS.find((r) => r.names.includes(name))!;
      expect(row.contract, name).toEqual({ module, anchor });
      expect(declaresValue(name), `${name} declared in the published surface`).toBe(true);
      if (leg === 'browser') {
        expect(shim, name).toContain(name);
        expect(backendLeg, name).not.toHaveProperty(name);
        expect(browserAmbient, name).toContain(name);
        expect(backendAmbient, name).not.toContain(name);
      } else {
        expect(backendLeg, name).toHaveProperty(name);
        expect(shim, name).not.toContain(name);
        expect(backendAmbient, name).toContain(name);
        expect(browserAmbient, name).not.toContain(name);
      }
    }
  }
  for (const name of names.types ?? []) expect(declaresType(name), `type ${name}`).toBe(true);
}

describe('L11 names of the consumer modules, per leg', () => {
  it('[section:m13l11sc] M13 carries clientPluginHost, registerFrontendModule, queryClient, the version hooks and lineDiffHunks in the browser, and the MCP facade, z, the validators and the content helpers on the backend', async () => {
    await assertCarried('M13', 'm13l11sc', {
      browser: [
        'clientPluginHost',
        'registerFrontendModule',
        'queryClient',
        'versionService',
        'useVersions',
        'useVersionDetail',
        'useRestoreVersion',
        'useVersionDiff',
        'lineDiffHunks',
      ],
      backend: ['createMcpServer', 'mcpTool', 'z', 'checkValidator', 'validatorMessage', 'contentBytes', 'DEFAULT_CONTENT_OPERATION'],
      types: ['McpServerFactory', 'ValidatorKind', 'ValidatorFailure', 'SlugPattern', 'SlugStep'],
    });
    // clientPluginHost: the active types, the change subscription and its counter.
    const host = /export declare const clientPluginHost: \{([\s\S]*?)\n\};/.exec(published)?.[1] ?? '';
    expect(host).toMatch(/listEntities\(\): FrontendModule\[\];/);
    expect(host).toMatch(/onRegistryChanged\(listener: \(\) => void\): \(\) => void;/);
    expect(host).toMatch(/registryVersion\(\): number;/);
    // useVersions returns the list; restore and the full version are hooks of their own.
    expect(published).toMatch(/export declare function useVersions\([^)]*\): QueryLike<VersionListItem\[\]>;/);
    expect(published).toMatch(/export declare function useRestoreVersion\(\): MutationLike<\{ type: string; slug: string; version: number \}, VersionListItem>;/);
    expect(published).toMatch(/export declare function useVersionDetail\([^)]*\): QueryLike<VersionDetail>;/);
    // lineDiffHunks speaks the one hunk vocabulary of DiffView.
    expect(published).toMatch(/export declare function lineDiffHunks\([\s\S]*?\): \{ op: 'add' \| 'del' \| 'ctx'; line: string \}\[\];/);
    // Recorded inside the current baseline: no version bump.
    expect(HOST_API_VERSION).toBe('2.1.0');
  });

  it('[section:m05l11sc] M05 carries startSeededThread, on the browser leg only', async () => {
    await assertCarried('M05', 'm05l11sc', { browser: ['startSeededThread'], types: ['StartSeededThreadOptions'] });
    expect(published).toMatch(/export declare function startSeededThread\(prompt: string, opts\?: StartSeededThreadOptions\): void;/);
  });

  it('[section:mn59j0le] M18 carries tagsService, useTags, useEntityTags, useAssignTags, useRemoveEntityTag and useCreateTag on the browser leg, typed in the published surface', async () => {
    await assertCarried('M18', 'mn59j0le', {
      browser: ['tagsService', 'useTags', 'useEntityTags', 'useAssignTags', 'useRemoveEntityTag', 'useCreateTag'],
      types: ['TagListItem'],
    });
    expect(published).toMatch(/export declare function useEntityTags\(type: string, slug: string \| null\): QueryLike<string\[\]>;/);
    expect(published).toMatch(/export declare function useAssignTags\(\): MutationLike<\{ type: string; slug: string; tags: string\[\] \}, string\[\]>;/);
    expect(published).toMatch(/export declare function useRemoveEntityTag\(\): MutationLike</);
    expect(published).toMatch(/export declare function useCreateTag\(\): MutationLike<string, TagListItem>;/);
  });

  it('[section:m20l11sc] M20 carries editorBridge and EditorBridgeProvider on the browser leg, typed by the EditorBridge contract', async () => {
    await assertCarried('M20', 'm20l11sc', { browser: ['editorBridge', 'EditorBridgeProvider'], types: ['EditorBridge'] });
    const bridge = /export interface EditorBridge \{([\s\S]*?)\n\}/.exec(published)?.[1] ?? '';
    expect(bridge).toMatch(/openEntity: \(type: string, slug: string\) => void;/);
    expect(bridge).toMatch(/openSection: \(pagePath: string, anchor: string\) => void;/);
    expect(published).toMatch(/export declare const editorBridge: EditorBridge;/);
    expect(published).toMatch(/export declare function EditorBridgeProvider\(props: \{\s*bridge: EditorBridge;/);
  });

  it('[section:gz7q92lz] M39 carries TOOL_RESULT_CEILING_TOKENS and DomainError on the backend leg — the host\'s own values', async () => {
    await assertCarried('M39', 'gz7q92lz', { backend: ['TOOL_RESULT_CEILING_TOKENS', 'DomainError'] });
    expect(typeof backendLeg.TOOL_RESULT_CEILING_TOKENS).toBe('number');
    expect(backendLeg.TOOL_RESULT_CEILING_TOKENS).toBeGreaterThan(0);
    // The class the host narrows on with `instanceof` — not a copy.
    expect(backendLeg.DomainError).toBe(DomainError);
    expect(published).toMatch(/export declare const TOOL_RESULT_CEILING_TOKENS: number;/);
    expect(published).toMatch(/export declare class DomainError extends Error/);
  });

  it('[section:tbeatf5z] M50 carries openPopover, openModal, confirmDestructive and toast on the browser leg, with kind an open string', async () => {
    await assertCarried('M50', 'tbeatf5z', {
      browser: ['openPopover', 'openModal', 'confirmDestructive', 'toast'],
      types: ['ToastAction', 'ToastOptions', 'ConfirmDestructiveOptions'],
    });
    // Signatures of the host helpers, `kind` typed as any string.
    expect(published).toMatch(/export declare function openPopover<R = unknown>\(\s*kind: string,\s*input: \{ x: number; y: number; \[prop: string\]: unknown \},\s*\): Promise<R \| null>;/);
    expect(published).toMatch(/export declare function openModal<R = unknown>\(\s*kind: string,\s*props: Record<string, unknown>,\s*options\?: \{ dismissible\?: boolean \},\s*\): Promise<R \| null>;/);
    expect(published).toMatch(/export declare function confirmDestructive\(\s*kind: string,\s*options: ConfirmDestructiveOptions,\s*\): Promise<boolean>;/);
    const toast = /export declare const toast: \{([\s\S]*?)\n\};/.exec(published)?.[1] ?? '';
    for (const variant of ['success', 'error', 'warning']) {
      expect(toast).toContain(`${variant}(message: string, action?: ToastAction | ToastOptions): void;`);
    }
    // A toast has no kind; `info` is not plugin surface.
    expect(toast).not.toMatch(/kind|info\(/);
    // The `c4s:*` window events are not plugin surface: nothing published names them.
    expect(published).not.toMatch(/'c4s:(?:popover-open|modal-open|confirm-open|toast)'/);
    // Additive within the current baseline: no version bump.
    expect(HOST_API_VERSION).toBe('2.1.0');
  });
});
