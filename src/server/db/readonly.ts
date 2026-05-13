import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export class ReadonlyDbError extends Error {
  constructor(public code: 'PROJECT_NOT_FOUND' | 'SCHEMA_OUT_OF_DATE', message: string, public hint?: string) {
    super(message);
    this.name = 'ReadonlyDbError';
  }
}

export interface OpenDbReadonlyResult {
  handle: Database.Database;
  dbPath: string;
  close: () => void;
}

export function openDbReadonly(projectDir: string): OpenDbReadonlyResult {
  const dbPath = path.join(projectDir, '.claude4spec', 'db.sqlite');
  if (!fs.existsSync(dbPath)) {
    throw new ReadonlyDbError(
      'PROJECT_NOT_FOUND',
      `no claude4spec project found at ${projectDir}`,
      'run `npx claude4spec` first or pass `--project <path>`'
    );
  }
  let handle: Database.Database;
  try {
    handle = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw new ReadonlyDbError(
      'PROJECT_NOT_FOUND',
      `failed to open ${dbPath}: ${(err as Error).message}`
    );
  }
  return {
    handle,
    dbPath,
    close: () => handle.close(),
  };
}
