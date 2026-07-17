/**
 * M33 (0.1.134) — unit half of the backend `@c4s/plugin-runtime` resolver.
 *
 * Scope note: this file covers the pure specifier map and the installer's wiring
 * (via its `register` seam). It deliberately does NOT exercise the hook itself —
 * vitest's module runner can't run `module.register` any more than it can
 * `import.meta.resolve`, so in-process coverage there would prove nothing. The real
 * resolution, singleton identity and error paths are proven against the actual
 * runtime in `plugin-runtime-resolver.subprocess.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mapRuntimeSpecifier,
  type RuntimeTargets,
} from './plugin-runtime-specifiers.js';
import {
  installPluginRuntimeResolver,
  resetPluginRuntimeResolverForTests,
} from './plugin-runtime-resolver.js';

const TARGETS: RuntimeTargets = {
  runtime: 'file:///host/server/plugin-runtime/index.js',
  ui: 'file:///host/server/plugin-runtime/ui.js',
  self: 'file:///host/server/core/plugin-host/plugin-runtime-resolver.js',
};

describe('mapRuntimeSpecifier', () => {
  it('maps the two bound specifiers to the host barrels', () => {
    expect(mapRuntimeSpecifier('@c4s/plugin-runtime', TARGETS)).toBe(TARGETS.runtime);
    expect(mapRuntimeSpecifier('@c4s/plugin-runtime/ui', TARGETS)).toBe(TARGETS.ui);
  });

  it('delegates anything that is not ours (undefined)', () => {
    // The hot path: every import in the process passes through the hook.
    for (const spec of ['react', 'node:fs', 'express', '@inharness-ai/agent-adapters', './local.js']) {
      expect(mapRuntimeSpecifier(spec, TARGETS)).toBeUndefined();
    }
  });

  it('rejects an unknown subpath (null) rather than delegating it', () => {
    // Delegating would surface as "Cannot find package '@c4s/plugin-runtime'",
    // sending the author after a dependency that was never meant to be installed.
    expect(mapRuntimeSpecifier('@c4s/plugin-runtime/nope', TARGETS)).toBeNull();
    expect(mapRuntimeSpecifier('@c4s/plugin-runtime/ui/deep', TARGETS)).toBeNull();
  });

  it('does not treat a look-alike package name as ours', () => {
    expect(mapRuntimeSpecifier('@c4s/plugin-runtime-extra', TARGETS)).toBeUndefined();
  });
});

describe('installPluginRuntimeResolver', () => {
  afterEach(() => {
    resetPluginRuntimeResolverForTests();
    vi.restoreAllMocks();
  });

  it('registers once per process however many times it is called', () => {
    // Several entry points call this, and projects load lazily — but a process needs
    // exactly one registration.
    const register = vi.fn();
    expect(installPluginRuntimeResolver(register)).toBe(true);
    expect(installPluginRuntimeResolver(register)).toBe(true);
    expect(installPluginRuntimeResolver(register)).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('passes the hook module plus both barrel targets as data', () => {
    const register = vi.fn();
    installPluginRuntimeResolver(register);

    const [hookUrl, options] = register.mock.calls[0] as [string, { data: RuntimeTargets }];
    expect(hookUrl).toContain('plugin-runtime-hooks.js');
    // Spelled `.js` in both trees on purpose — tsx maps it to `.ts` in dev.
    expect(options.data.runtime).toContain('/plugin-runtime/index.js');
    expect(options.data.ui).toContain('/plugin-runtime/ui.js');
    expect(options.data.self).toContain('plugin-runtime-resolver');
  });

  it('degrades with a warning when module.register is missing (node <20.6)', () => {
    // engines.node is ">=20" but module.register landed in 20.6. A host that can't
    // register hooks must still load plugins that don't use the bare alias.
    // `null`, not `undefined`: the latter would trigger the default parameter and
    // reach for the REAL module.register, which is what this test is standing in for.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(installPluginRuntimeResolver(null)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('@inharness-ai/claude4spec/plugin-runtime');
  });

  it('degrades with a warning when registration throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const register = vi.fn(() => {
      throw new Error('loader thread unavailable');
    });
    expect(installPluginRuntimeResolver(register)).toBe(false);
    expect(warn.mock.calls[0][0]).toContain('loader thread unavailable');
  });

  it('does not retry after a failed attempt', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const register = vi.fn(() => {
      throw new Error('nope');
    });
    installPluginRuntimeResolver(register);
    installPluginRuntimeResolver(register);
    expect(register).toHaveBeenCalledTimes(1);
  });
});
