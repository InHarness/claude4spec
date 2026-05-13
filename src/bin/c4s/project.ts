import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.js';

export function resolveProject(override?: string): string {
  if (override) {
    const abs = path.resolve(process.cwd(), override);
    if (!fs.existsSync(path.join(abs, '.claude4spec', 'db.sqlite'))) {
      throw new CliError(
        'PROJECT_NOT_FOUND',
        `no claude4spec project at ${abs}`,
        'check the path or run `npx claude4spec` there first'
      );
    }
    return abs;
  }
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, '.claude4spec', 'db.sqlite'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new CliError(
        'PROJECT_NOT_FOUND',
        'no claude4spec project found in current directory or any parent',
        'run `npx claude4spec` first or pass `--project <path>`'
      );
    }
    dir = parent;
  }
}
