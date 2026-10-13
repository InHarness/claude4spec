/**
 * PUBLISHED types of the plugin test harness —
 * `@inharness-ai/claude4spec/plugin-testing` (M33 L11, 2.1.17 `m33l11sc`).
 *
 * A plugin author types an integration test through this `.d.ts` alone: no
 * vendored copy of the harness types, and no host-internal type behind it.
 *   - The manifest and the host facade are typed by types ALREADY published
 *     under `…/plugin-runtime` (`PluginManifest`, `MountContext['host']`,
 *     `MountContext['crud']`) — imported from the sibling declaration file, so
 *     the two subpaths cannot drift apart.
 *   - The server-bound elements (the HTTP application, the database handle, the
 *     broadcast emitter's events) are loosely typed, as the `MountContext` slots
 *     are: their real types (express, better-sqlite3) are server dependencies a
 *     plugin's own build never installs.
 *
 * Outside the versioned Host API surface: this file is NOT part of the
 * `hostApiVersion` contract (`…/plugin-runtime` + `/ui`) and `plugin-runtime.ts`
 * / `ui.ts` never import it. Adding the subpath, or changing the shape below —
 * even breaking it — does not move `HOST_API_VERSION`; the npm semver of the
 * package is the only compatibility signal for the harness.
 *
 * The implementation is `src/server/plugin-testing/index.ts`.
 */

import type { MountContext, PluginManifest } from './plugin-runtime.js';

/** What `createPluginTestApp` hands back: a host running in this process on a temporary project. */
export interface PluginTestApp {
  /**
   * The HTTP application (an express app — pass it to `supertest`, or
   * `app.listen(0)`). The project's routes are mounted under `baseUrl`.
   */
  app: any;
  /** The temporary project's id. */
  projectId: string;
  /** `/api/projects/<projectId>` — the prefix of every project route. */
  baseUrl: string;
  /** Entity CRUD — the same write door the plugin under test gets as `MountContext.crud`. */
  crud: MountContext['crud'];
  /** The project's host facade — the object the plugin gets as `MountContext.host`. */
  host: MountContext['host'];
  /** The temporary project's working directory. */
  cwd: string;
  /**
   * The project database (a better-sqlite3 handle), for test assertions only.
   * It is never put on the plugin's `MountContext`, and reading it does not make
   * the projection's shape a contract.
   */
  db: any;
  /** Every WS event the project broadcast, in order (`broadcasts.length = 0` clears it). */
  broadcasts: unknown[];
  /**
   * Disposes the host and only then removes the temporary directory; once it
   * resolves, nothing of this instance is running or logging (the host's
   * background boot work settled before `createPluginTestApp` returned).
   */
  cleanup(): Promise<void>;
}

/**
 * Starts a real host in this process on a temporary project with `manifests`
 * registered through the loader's registration point, their entity types active
 * without configuration. Rejects with the registration point's own error for a
 * manifest the loader would reject. Does NOT run the loader's discovery, import,
 * `hostApiVersion` / `engines` or trust gates.
 */
export declare function createPluginTestApp(manifests: PluginManifest[]): Promise<PluginTestApp>;
