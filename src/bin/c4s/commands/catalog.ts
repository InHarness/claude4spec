import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedArgs } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import type { CliCommandContribution } from '../registry.js';

export async function runCatalog(args: ParsedArgs): Promise<void> {
  const ctx = await createContext(args);
  try {
    const catalog = ctx.registry.catalog(ctx.reader);
    writeOutput({ ...catalog, claude4spec: readPackageVersion() }, args);
  } finally {
    ctx.close();
  }
}

export const catalogCommand: CliCommandContribution = {
  name: 'catalog',
  executionMode: 'readonly-reader',
  errorCodes: [],
  handler: runCatalog,
};

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/bin/c4s/commands → packageRoot, or src/bin/c4s/commands → packageRoot
    const roots = [
      path.resolve(here, '..', '..', '..', '..'),
      path.resolve(here, '..', '..', '..'),
    ];
    for (const root of roots) {
      const pkgPath = path.join(root, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    /* ignore */
  }
  return 'unknown';
}
