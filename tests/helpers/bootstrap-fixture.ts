/**
 * 2.1.77 (M31 `m31boot01`, `bzgfftsf`): `bootstrapProject` tells the
 * registration path by the presence of a type — a directory without
 * `.claude4spec/config.json` is a new project and needs a type, a directory
 * with one is an existing project and takes none. A fixture that just wants a
 * project in a directory takes the path the directory fits: a fresh directory
 * becomes a new project of `projectType` (default `spec`, the type a project
 * without one is read as), a directory whose config the fixture already wrote
 * is added as it stands.
 */
import fs from 'node:fs';
import { configPath } from '../../src/server/config.js';
import {
  bootstrapProject,
  type ActivatedProjects,
  type BootstrapResult,
} from '../../src/server/workspace/bootstrap.js';
import type { WorkspaceRecord } from '../../src/server/workspace/types.js';
import type { WorkspaceRegistry } from '../../src/server/workspace/registry.js';

export function bootstrapFixture(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  cwd: string,
  activated?: ActivatedProjects,
  projectType = 'spec',
): BootstrapResult {
  const fresh = !fs.existsSync(configPath(cwd));
  return bootstrapProject(registry, workspace, cwd, activated, fresh ? projectType : undefined);
}
