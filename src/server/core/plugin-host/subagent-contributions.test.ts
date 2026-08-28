/**
 * `contributes.subagents` as the FIFTH pull-read capability.
 *
 * The point of these cases is the plumbing, not the policy: raw contributions must ride
 * the plugin record and the project-local overlay untouched, reach
 * `ProjectPluginHost.listSubagents()` in discovery order, and disappear the moment the
 * record does. Validation, dedupe and sanitizing live in `services/plugin-subagents.ts`
 * and are covered there.
 */
import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import type { ProjectPluginOverlay } from './types.js';
import type { PluginManifest, PluginSubagentContribution } from '../../../shared/plugin-host/manifest.js';

const sub = (name: string): PluginSubagentContribution => ({
  name,
  description: `Explores ${name}.`,
  promptBody: `Body for ${name}.`,
  tools: ['mcp__reference-tools__get_page'],
});

function manifest(name: string, subagents: PluginSubagentContribution[]): PluginManifest {
  return {
    name,
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    contributes: { subagents },
  };
}

function overlayWith(subagents: PluginSubagentContribution[]): ProjectPluginOverlay {
  return {
    listLocal: () => [],
    origin: () => '',
    listSettings: () => [],
    listCommands: () => [],
    listSubagents: () => subagents,
  };
}

describe('contributes.subagents — pull-read off the plugin record', () => {
  it('an entity-less plugin contributing only a subagent still surfaces it', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifest('@acme/only-a-subagent', [sub('domain-explore')]));
    const host = registry.consolidate({});
    expect(host.listSubagents().map((s) => s.name)).toEqual(['domain-explore']);
  });

  it('carries the contribution RAW — policy is not applied at registration', () => {
    const registry = new PluginRegistryImpl();
    // A name the host reserves and a tool the sanitizer strips: both must survive THIS
    // layer untouched, because dedupe and sanitizing span both layers and happen per turn.
    registry.registerPlugin(
      manifest('@acme/raw', [{ ...sub('spec-explore'), tools: ['Agent'] }]),
    );
    const [only] = registry.consolidate({}).listSubagents();
    expect(only!.name).toBe('spec-explore');
    expect(only!.tools).toEqual(['Agent']);
  });

  /**
   * The teardown-free claim, as a test. `unregisterPlugin` deletes the record and nothing
   * else; because `listSubagents()` reads by pull and keeps no copy, that is the whole of
   * the teardown — the contribution is gone from the next turn with no session restart.
   */
  it('unregisterPlugin removes the contribution with no teardown step of its own', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifest('@acme/p', [sub('domain-explore')]));
    expect(registry.consolidate({}).listSubagents()).toHaveLength(1);

    registry.unregisterPlugin('@acme/p');
    expect(registry.consolidate({}).listSubagents()).toEqual([]);
  });

  it('a plugin declaring no subagents contributes none', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin({
      name: '@acme/quiet',
      version: '1.0.0',
      hostApiVersion: '^2.0.0',
      contributes: {},
    });
    expect(registry.consolidate({}).listSubagents()).toEqual([]);
  });
});

describe('contributes.subagents — base pool ∪ project-local overlay', () => {
  it('concatenates base then overlay, preserving discovery order', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifest('@acme/a', [sub('from-base')]));
    const host = registry.consolidate({}, overlayWith([sub('from-overlay')]));
    // Order is the dedupe key downstream (first-by-discovery wins), so base must lead.
    expect(host.listSubagents().map((s) => s.name)).toEqual(['from-base', 'from-overlay']);
  });

  it('a project-local plugin contributes on equal footing with an npm-installed one', () => {
    const registry = new PluginRegistryImpl();
    const host = registry.consolidate({}, overlayWith([sub('local-only')]));
    expect(host.listSubagents().map((s) => s.name)).toEqual(['local-only']);
  });

  it('does NOT shadow by plugin name the way listSettings does', () => {
    // Two layers, same plugin name, different subagents: both must reach the resolver so
    // it can apply first-wins itself. Collapsing them here would hide the collision.
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifest('@acme/same', [sub('base-one')]));
    const host = registry.consolidate({}, overlayWith([sub('overlay-one')]));
    expect(host.listSubagents()).toHaveLength(2);
  });

  it('is unaffected by the config.entities whitelist (axis B, not axis A)', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifest('@acme/a', [sub('domain-explore')]));
    // An entity whitelist that admits nothing must not take the subagent with it.
    const host = registry.consolidate({ entities: [] } as never);
    expect(host.listSubagents().map((s) => s.name)).toEqual(['domain-explore']);
  });
});
