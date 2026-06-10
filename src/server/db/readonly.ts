import Database from 'better-sqlite3';
import fs from 'node:fs';

export class ReadonlyDbError extends Error {
  constructor(
    public code: 'PROJECT_NOT_FOUND' | 'SCHEMA_OUT_OF_DATE' | 'INDEX_NOT_MATERIALIZED',
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'ReadonlyDbError';
  }
}

export interface OpenDbReadonlyResult {
  handle: Database.Database;
  dbPath: string;
  close: () => void;
}

/**
 * M31: takes the resolved slot DB path (from `resolveWorkspaceProject`), not a
 * project dir — the derived index lives in `~/.claude4spec/<ws>/<id>/`. A
 * registered-but-never-served slot has no db.sqlite yet → INDEX_NOT_MATERIALIZED.
 */
export function openDbReadonly(dbPath: string): OpenDbReadonlyResult {
  if (!fs.existsSync(dbPath)) {
    throw new ReadonlyDbError(
      'INDEX_NOT_MATERIALIZED',
      `no derived index at ${dbPath}`,
      'run `npx @inharness-ai/claude4spec` in the project to build the index for this workspace',
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
