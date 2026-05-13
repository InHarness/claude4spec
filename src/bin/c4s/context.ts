import { openDbReadonly, ReadonlyDbError } from '../../server/db/readonly.js';
import { RawEntityReader } from '../../server/domain/raw-entity-reader.js';
import { serializationEngine } from '../../server/core/plugin-host/serialization-engine.js';
import '../../server/serialization/registerAll.js';
import { CliError } from './errors.js';
import { resolveProject } from './project.js';
import type { ParsedArgs } from './args.js';

export interface CliContext {
  projectDir: string;
  reader: RawEntityReader;
  registry: typeof serializationEngine;
  db: import('better-sqlite3').Database;
  close: () => void;
}

export function createContext(args: ParsedArgs): CliContext {
  const projectDir = resolveProject(args.project);
  try {
    const { handle, close } = openDbReadonly(projectDir);
    const reader = new RawEntityReader(handle);
    return {
      projectDir,
      reader,
      registry: serializationEngine,
      db: handle,
      close,
    };
  } catch (err) {
    if (err instanceof ReadonlyDbError) {
      throw new CliError(err.code, err.message, err.hint);
    }
    throw err;
  }
}
