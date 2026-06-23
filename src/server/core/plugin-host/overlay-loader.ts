/**
 * M33 phase 2 — project-local plugin overlay loader.
 *
 * The second of the two M33 tracks (the first being the process-global
 * `loadWorkspacePlugins`). This one loads plugins committed into a repo at
 * `<cwd>/.claude4spec/plugins/<pkg>/` and builds a per-`ProjectContext`
 * `ProjectPluginOverlay`. Because a `git clone` brings this code with it,
 * loading is gated by `trustProjectPlugins` — the CALLER decides trust and only
 * invokes `loadProjectOverlay` when trusted; `enumerateOverlayPackages` is the
 * code-free probe used to drive the trust prompt.
 *
 * Per package, each step is isolated in its own try/catch so one bad plugin is
 * skipped — never failing the project build:
 *   1. Resolve entry  — package.json main/module/exports, else index.{js,mjs}.
 *   2. Dynamic import — `import(pathToFileURL(entry))` (native ESM).
 *   3. Validate+gate  — shared with the workspace loader (hostApiVersion+engines).
 *   4. Lower entities — `lowerEntityContribution`, enforcing within-overlay
 *      type uniqueness (second duplicate → PLUGIN_TYPE_CONFLICT, rejected).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  extractManifest,
  gateManifest,
  isValidManifestShape,
  type PluginLoadRecord,
} from './loader.js';
import { lowerEntityContribution, validateWritingStyle } from './manifest-adapter.js';
import type { BackendModule, ProjectPluginOverlay } from './types.js';
import type {
  PluginCommandContribution,
  PluginSettingsSection,
  WritingStyleContribution,
} from '../../../shared/plugin-host/manifest.js';

/** Importer seam — overridable in tests; defaults to native dynamic import. */
export type PluginImporter = (specifier: string) => Promise<unknown>;
const defaultImporter: PluginImporter = (specifier) => import(specifier);

/**
 * M33 phase 3 — cache-bust suffix for a dynamic ESM import. Node caches modules
 * per-URL, so re-importing the same `file://` href after an edit returns the
 * STALE module. A `?v=<contentHash>` query yields a fresh URL exactly when the
 * bytes change (and the cached one when they don't) — making a post-invalidation
 * context rebuild pick up an edited project-local plugin without a restart.
 */
function entryCacheBust(entry: string): string {
  try {
    const hash = crypto.createHash('sha1').update(fs.readFileSync(entry)).digest('hex').slice(0, 12);
    return `?v=${hash}`;
  } catch {
    return '';
  }
}

export interface ProjectOverlayResult {
  /** The overlay, or `undefined` when no loadable project-local module exists. */
  overlay: ProjectPluginOverlay | undefined;
  /** Per-package diagnostics for the per-project `/_meta/plugins` route. */
  records: PluginLoadRecord[];
  /** M15 phase 2: trusted project-local writing styles, pushed into SkillRegistry. */
  writingStyles: WritingStyleContribution[];
  /** Best-effort detach of imported project-local modules (see dispose note). */
  dispose: () => void;
}

/** Absolute path to a project's local plugins directory. */
export function projectPluginsDir(cwd: string): string {
  return path.join(cwd, '.claude4spec', 'plugins');
}

/**
 * Package directory names under `<cwd>/.claude4spec/plugins/`. Pure FS read — no
 * code runs — so it is safe to call before the trust decision (drives the prompt
 * and the untrusted-layer diagnostics).
 */
export function enumerateOverlayPackages(cwd: string): string[] {
  const dir = projectPluginsDir(cwd);
  let entries: fs.Dirent[];
  try {
    if (!fs.existsSync(dir)) return [];
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** True when the project ships at least one local plugin package. */
export function hasProjectPlugins(cwd: string): boolean {
  return enumerateOverlayPackages(cwd).length > 0;
}

/**
 * Resolve a package.json `exports` field to a relative entry path. Handles the
 * common shapes: a bare string, the `"."` subpath, and a conditions object
 * (`{ import, default, require, node }`) at either the top level or under `"."`.
 * Returns the first string match (preferring ESM `import`/`default`), or
 * undefined if no string entry is reachable (caller falls back to module/main).
 */
function resolveExportsEntry(exp: unknown): string | undefined {
  if (typeof exp === 'string') return exp;
  if (!exp || typeof exp !== 'object') return undefined;
  const obj = exp as Record<string, unknown>;
  // Subpath map: drill into "." first, then treat the whole object as conditions.
  const dot = obj['.'];
  if (typeof dot === 'string') return dot;
  const conditions = (dot && typeof dot === 'object' ? (dot as Record<string, unknown>) : obj);
  for (const key of ['import', 'module', 'default', 'node', 'require']) {
    const v = conditions[key];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** Resolve the ESM entry file of a package directory. Returns null if none found. */
function resolveEntry(pkgDir: string): string | null {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
        main?: string;
        module?: string;
        exports?: unknown;
      };
      const rel = resolveExportsEntry(pkg.exports) ?? pkg.module ?? pkg.main;
      if (rel) {
        const abs = path.resolve(pkgDir, rel);
        if (fs.existsSync(abs)) return abs;
      }
    } catch {
      /* fall through to index.* probing */
    }
  }
  for (const candidate of ['index.js', 'index.mjs', 'index.cjs']) {
    const abs = path.join(pkgDir, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/**
 * Load and validate the trusted project-local overlay for `cwd`. The caller must
 * have already confirmed `trustProjectPlugins === true`; this function executes
 * project-committed code.
 */
export async function loadProjectOverlay(
  cwd: string,
  importer: PluginImporter = defaultImporter,
): Promise<ProjectOverlayResult> {
  const records: PluginLoadRecord[] = [];
  const modules = new Map<string, BackendModule>();
  const originByType = new Map<string, string>();
  const writingStyles: WritingStyleContribution[] = [];
  // M33 phase 3: non-entity capabilities of trusted project-local plugins. An
  // entity-less plugin (commands/settings only) still produces these.
  const settingsSections: PluginSettingsSection[] = [];
  const commands: PluginCommandContribution[] = [];
  const teardowns: Array<() => void> = [];

  for (const pkg of enumerateOverlayPackages(cwd)) {
    const pkgDir = path.join(projectPluginsDir(cwd), pkg);
    const origin = path.join('.claude4spec', 'plugins', pkg);
    const base: PluginLoadRecord = { package: pkg, status: 'loaded', layer: 'overlay', trust: 'trusted', origin };

    const entry = resolveEntry(pkgDir);
    if (!entry) {
      const reason = 'no resolvable ESM entry (package.json main/module/exports or index.{js,mjs,cjs})';
      console.warn(`[overlay-loader] PLUGIN_INVALID_MANIFEST ${pkg}: ${reason}`);
      records.push({ ...base, status: 'failed', code: 'PLUGIN_INVALID_MANIFEST', reason });
      continue;
    }

    let mod: unknown;
    try {
      mod = await importer(pathToFileURL(entry).href + entryCacheBust(entry));
    } catch (err) {
      const reason = (err as Error).message;
      console.warn(`[overlay-loader] PLUGIN_IMPORT_FAILED ${pkg}: ${reason}`);
      records.push({ ...base, status: 'failed', code: 'PLUGIN_IMPORT_FAILED', reason });
      continue;
    }

    const manifest = extractManifest(mod);
    if (!isValidManifestShape(manifest)) {
      const reason = 'package does not export a valid PluginManifest (manifest/default)';
      console.warn(`[overlay-loader] PLUGIN_INVALID_MANIFEST ${pkg}: ${reason}`);
      records.push({ ...base, status: 'failed', code: 'PLUGIN_INVALID_MANIFEST', reason });
      continue;
    }

    const gate = gateManifest(manifest);
    if (gate) {
      console.warn(`[overlay-loader] ${gate.code} ${pkg}: ${gate.reason}`);
      records.push({
        ...base,
        status: 'skipped',
        code: gate.code,
        reason: gate.reason,
        manifestName: manifest.name,
        manifestVersion: manifest.version,
      });
      continue;
    }

    // Lower contributions (entities + styles) before committing — a throw on
    // either fails the whole plugin atomically.
    let lowered: BackendModule[];
    let styles: WritingStyleContribution[];
    try {
      lowered = (manifest.contributes?.entities ?? []).map(lowerEntityContribution);
      styles = (manifest.contributes?.writingStyles ?? []).map(validateWritingStyle);
    } catch (err) {
      const reason = (err as Error).message;
      console.warn(`[overlay-loader] PLUGIN_INVALID_MANIFEST ${pkg}: ${reason}`);
      records.push({ ...base, status: 'failed', code: 'PLUGIN_INVALID_MANIFEST', reason });
      continue;
    }

    // Enforce within-overlay (same-layer) type uniqueness.
    const conflict = lowered.find((m) => modules.has(m.type));
    if (conflict) {
      const reason = `type "${conflict.type}" already provided by another project-local plugin (origin ${originByType.get(conflict.type)})`;
      console.warn(`[overlay-loader] PLUGIN_TYPE_CONFLICT ${pkg}: ${reason}`);
      records.push({ ...base, status: 'failed', code: 'PLUGIN_TYPE_CONFLICT', reason });
      continue;
    }

    for (const m of lowered) {
      modules.set(m.type, m);
      originByType.set(m.type, origin);
    }
    writingStyles.push(...styles);
    // M33 phase 3: capture non-entity capabilities + teardown of this trusted plugin.
    if ((manifest.contributes?.settings ?? []).length > 0) {
      settingsSections.push({
        name: manifest.name,
        version: manifest.version,
        fields: manifest.contributes!.settings!,
      });
    }
    commands.push(...(manifest.contributes?.commands ?? []));
    if (typeof manifest.onUnregister === 'function') {
      const fn = manifest.onUnregister.bind(manifest);
      teardowns.push(fn);
    } else {
      console.warn(
        `[overlay-loader] plugin "${manifest.name}" — required slot onUnregister is missing; using a no-op teardown`,
      );
    }
    records.push({
      ...base,
      manifestName: manifest.name,
      manifestVersion: manifest.version,
      contributedTypes: lowered.map((m) => m.type),
    });
  }

  // Node's ESM registry caches modules by URL — a true unload is not possible.
  // dispose() runs each plugin's `onUnregister` (M33 phase 3 teardown) then
  // drops the host-side references (mirrors clearMcpFactories); a rebuild
  // re-imports (cached) fresh manifests. Stateful native handles, if a plugin
  // opens any, are the plugin's own teardown responsibility.
  const dispose = () => {
    for (const teardown of teardowns) {
      try {
        teardown();
      } catch (err) {
        console.warn(`[overlay-loader] onUnregister threw during dispose: ${(err as Error).message}`);
      }
    }
    modules.clear();
    originByType.clear();
  };

  // No capabilities at all ⇒ no overlay host layer, but a plugin may still have
  // contributed writing styles — return those so the caller can push them.
  // M33 phase 3: an entity-less plugin with only settings/commands DOES produce
  // an overlay so the host surfaces those capabilities (axis B).
  if (modules.size === 0 && settingsSections.length === 0 && commands.length === 0) {
    return { overlay: undefined, records, writingStyles, dispose };
  }

  const overlay: ProjectPluginOverlay = {
    listLocal: () => Array.from(modules.values()),
    origin: (type) => originByType.get(type) ?? '',
    listSettings: () => settingsSections,
    listCommands: () => commands,
  };

  return { overlay, records, writingStyles, dispose };
}
