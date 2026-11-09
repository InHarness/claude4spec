import fs from 'node:fs';
import { configPath, DEFAULT_PROJECT_TYPE } from '../config.js';
import { projectCapabilitySet, type ProjectCapabilities } from './capabilities.js';
import { hostProjectTypeRegistry, type ProjectTypeEntry, type ProjectTypeRegistry } from './registry.js';

/**
 * 2.1.77 (M01 `dsh8ezbz` step 3, `u6mmds6k`; M57 `zy42cyj7`, `366wogto`; M31
 * `bzgfftsf`): the refusals of the type resolution.
 *  - `PROJECT_TYPE_UNKNOWN`  — a slug outside the type registry;
 *  - `PROJECT_TYPE_CONFLICT` — a type given from outside differs from the one in `config.json`;
 *  - `PROJECT_TYPE_MISMATCH` — `config.json` and the copy in the workspace record disagree.
 */
export type ProjectTypeErrorCode = 'PROJECT_TYPE_UNKNOWN' | 'PROJECT_TYPE_CONFLICT' | 'PROJECT_TYPE_MISMATCH';

export class ProjectTypeError extends Error {
  constructor(
    readonly code: ProjectTypeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectTypeError';
  }
}

/** The `multi-root` capability (M01 `9t587fj1`). */
export const MULTI_ROOT = 'multi-root';
/** The `entities` capability (M01 `hbib9dy0`). */
export const ENTITIES = 'entities';

/**
 * The `projectType` a project directory's `config.json` carries, read raw:
 * `undefined` when there is no file, the default (`spec`) when the file has no
 * key — an existing file without the key is a Specification and is not filled
 * in. A file that does not parse is left to the config loader (it throws there).
 */
export function readFileProjectType(cwd: string): string | undefined {
  const file = configPath(cwd);
  if (!fs.existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> | null;
    const value = raw && typeof raw === 'object' ? raw.projectType : undefined;
    return typeof value === 'string' ? value : DEFAULT_PROJECT_TYPE;
  } catch {
    return DEFAULT_PROJECT_TYPE;
  }
}

export interface ResolveProjectTypeInput {
  /** The type in `config.json` (absent key = `spec`); `undefined` = no file. */
  fileType: string | undefined;
  /** The type given from outside (the new-project path, `PROJECT_TYPE`); absent = none. */
  inputType?: string;
  /** The copy in the workspace record (absent field = `spec`); `undefined` = no record yet. */
  copyType?: string | null;
  types?: ProjectTypeRegistry;
}

export interface ResolvedProjectType {
  entry: ProjectTypeEntry;
  /** The project's capability set — fixed for the life of the context (M57 `rdztxzb8`). */
  capabilities: ProjectCapabilities;
}

/**
 * Step 3 of the activation: the file's key gives the type, a file without the
 * key gives `spec`, no file gives the input type, and no input `spec`. Then, in
 * this order: input ≠ file → `PROJECT_TYPE_CONFLICT`; outside the registry →
 * `PROJECT_TYPE_UNKNOWN` (no fallback to Specification); file ≠ copy →
 * `PROJECT_TYPE_MISMATCH`.
 */
export function resolveProjectType(input: ResolveProjectTypeInput): ResolvedProjectType {
  const types = input.types ?? hostProjectTypeRegistry();
  const { fileType, inputType } = input;
  const slug = fileType ?? inputType ?? DEFAULT_PROJECT_TYPE;
  if (fileType !== undefined && inputType !== undefined && inputType !== fileType) {
    throw new ProjectTypeError(
      'PROJECT_TYPE_CONFLICT',
      `the project type "${inputType}" differs from the type "${fileType}" in the directory's config.json`,
    );
  }
  const entry = types.get(slug);
  if (!entry) {
    throw new ProjectTypeError('PROJECT_TYPE_UNKNOWN', `unknown project type "${slug}" — not in the project-type registry`);
  }
  if (input.copyType !== undefined) {
    const copy = input.copyType ?? DEFAULT_PROJECT_TYPE;
    if (copy !== slug) {
      throw new ProjectTypeError(
        'PROJECT_TYPE_MISMATCH',
        `the project type "${slug}" in config.json differs from its copy "${copy}" in the workspace record`,
      );
    }
  }
  return { entry, capabilities: projectCapabilitySet(entry.capabilities) };
}

/**
 * M01 `kt5gesnm` (`roots[]`): without `multi-root` the array carries only the
 * base root's entry — any other entry is an error. `null` = valid.
 */
export function multiRootViolation(roots: readonly { id: string; builtin: boolean }[], capabilities: ProjectCapabilities): string | null {
  if (capabilities.has(MULTI_ROOT)) return null;
  const extra = roots.filter((r) => !r.builtin);
  if (extra.length === 0) return null;
  return `roots[] may carry only the base root in a project without the "${MULTI_ROOT}" capability (extra: ${extra
    .map((r) => `"${r.id}"`)
    .join(', ')})`;
}
