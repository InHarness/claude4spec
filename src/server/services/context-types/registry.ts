/**
 * 2.1.88 (M44 `k3gkrn09`, `tug9fzdn`, `8rnqx0vu`) — the context-type registry as a
 * code map of the rows the owner modules contribute, the project registry derived
 * from it, and the start-up validation of its invariants.
 */

import { TOOL_GROUPS, type ToolGroup } from '@inharness-ai/agent-adapters';
import type { ChatContextType } from '../../../shared/entities.js';
import type { OperationClass } from '../../operations/catalog.js';
import { ASK_ROW } from './rows/ask.js';
import { BRIEF_ROW } from './rows/brief.js';
import { CHAT_ROW } from './rows/chat.js';
import { PATCH_ROW } from './rows/patch.js';
import { rowRequiredCapabilities, type ContextTypeRow } from './row.js';

/** All operation classes the host catalog knows (M43 `l3route0`) — what `Klasy operacji: wszystkie` stands for. */
const ALL_OPERATION_CLASSES: readonly OperationClass[] = ['read', 'write', 'brief', 'plan', 'turn', 'peer'];

/** The consultation server (M11): a value with `Wejście: konsultacja` must not name it. */
export const CONSULTATION_SERVER = 'c4s-tools';

/** The contributed rows, in registry order. */
export const CONTEXT_TYPE_ROWS: readonly ContextTypeRow[] = [CHAT_ROW, BRIEF_ROW, PATCH_ROW, ASK_ROW];

/** The code map, keyed by value. */
export const CONTEXT_TYPE_REGISTRY: Readonly<Record<ChatContextType, ContextTypeRow>> = Object.fromEntries(
  CONTEXT_TYPE_ROWS.map((row) => [row.value, row]),
) as Record<ChatContextType, ContextTypeRow>;

type CapabilitySet = { has(name: string): boolean };

/** Every capability, for call-sites without a project (rigs). */
const EVERY_CAPABILITY: CapabilitySet = { has: () => true };

/**
 * M44 `tug9fzdn` — the project registry: the rows whose required capabilities
 * (the contributing module's plus the row's own) the project has. A value outside
 * it does not exist in that project.
 */
export function projectContextTypeRows(
  capabilities: CapabilitySet = EVERY_CAPABILITY,
  rows: readonly ContextTypeRow[] = CONTEXT_TYPE_ROWS,
): ContextTypeRow[] {
  return rows.filter((row) => rowRequiredCapabilities(row).every((c) => capabilities.has(c)));
}

/** M44 `zvy49ysg` — the value a thread opened without naming a type gets: the one row with `Wejście: domyślny`. */
export function defaultContextType(capabilities: CapabilitySet = EVERY_CAPABILITY): ChatContextType {
  const row = projectContextTypeRows(capabilities).find((r) => r.entry.includes('default'));
  if (!row) throw new Error('context-type registry has no value with entry "default"');
  return row.value;
}

/** The project's consultation value (`Wejście: konsultacja`), if any. */
export function consultationContextType(capabilities: CapabilitySet = EVERY_CAPABILITY): ChatContextType | null {
  return projectContextTypeRows(capabilities).find((r) => r.entry.includes('consultation'))?.value ?? null;
}

/**
 * The rows of a project registry given by its values (`AgentTurnDeps.contextTypes`,
 * i.e. `contextTypesFor(capabilities)`), in registry order. Absent (rigs) = every row.
 */
export function rowsOfRegistry(values: readonly string[] | undefined): ContextTypeRow[] {
  return values ? CONTEXT_TYPE_ROWS.filter((row) => values.includes(row.value)) : [...CONTEXT_TYPE_ROWS];
}

/**
 * M05 `6vum1iqz` / `POST /api/threads` — how the generic create-thread route
 * resolves the value of a new thread in ONE project registry:
 *   - `entry: "consultation"` → the row with `Wejście: konsultacja` (null when the
 *     registry has none — `PROJECT_WITHOUT_CONSULTATION`);
 *   - `context_type` → that value, only when its row has `nowy wątek` (or
 *     `domyślny`, which contains it); otherwise null — `VALIDATION`;
 *   - neither → the value with `Wejście: domyślny`.
 */
export function consultationRowOf(rows: readonly ContextTypeRow[]): ContextTypeRow | null {
  return rows.find((r) => r.entry.includes('consultation')) ?? null;
}

export function newThreadRowOf(rows: readonly ContextTypeRow[], value: string): ContextTypeRow | null {
  const row = rows.find((r) => r.value === value);
  if (!row) return null;
  return row.entry.includes('new-thread') || row.entry.includes('default') ? row : null;
}

export function defaultRowOf(rows: readonly ContextTypeRow[]): ContextTypeRow {
  const row = rows.find((r) => r.entry.includes('default'));
  if (!row) throw new Error('context-type registry has no value with entry "default"');
  return row;
}

/** `Klasy operacji` as the set the profile gate admits. */
export function rowOperationClasses(row: ContextTypeRow): ReadonlySet<OperationClass> {
  return new Set(row.operationClasses === 'all' ? ALL_OPERATION_CLASSES : row.operationClasses);
}

/** `Grupy wbudowane` as the groups the row adds to the turn's deny union. */
export function rowBuiltinGroups(row: ContextTypeRow): ToolGroup[] {
  if (row.builtinGroups === 'none') return [];
  if (row.builtinGroups === 'all') return [...TOOL_GROUPS];
  return [...row.builtinGroups];
}

/**
 * `Postura` (M44 `3f5ej79s`) — whether the thread flag binds: a pinned posture
 * forces its value every turn, an unavailable one means plan mode is off.
 */
export function effectivePlanMode(row: ContextTypeRow, threadPlanMode: boolean): boolean {
  switch (row.posture.kind) {
    case 'pinned':
      return row.posture.planMode;
    case 'unavailable':
      return false;
    default:
      return threadPlanMode;
  }
}

export const CONTEXT_TYPE_REGISTRY_INVALID = 'CONTEXT_TYPE_REGISTRY_INVALID';

export class ContextTypeRegistryError extends Error {
  readonly code = CONTEXT_TYPE_REGISTRY_INVALID;
  constructor(
    readonly projectType: string,
    message: string,
  ) {
    super(`${CONTEXT_TYPE_REGISTRY_INVALID}: project type "${projectType}": ${message}`);
    this.name = 'ContextTypeRegistryError';
  }
}

/**
 * M44 `8rnqx0vu` — the start-up check. For the capability set of every project
 * type: exactly one value with `default`; at most one with `consultation`; that
 * one admits only `read`/`plan`, does not name the consultation server and has a
 * pinned or unavailable posture; every `own` composition names an existing
 * recipe. These are construction invariants, not acceptance criteria — a user
 * cannot trigger them — so a violation stops the host.
 */
export function validateContextTypeRegistry(
  projectTypes: ReadonlyArray<{ slug: string; capabilities: readonly string[] }>,
  rows: readonly ContextTypeRow[] = CONTEXT_TYPE_ROWS,
): void {
  for (const type of projectTypes) {
    const caps = new Set(type.capabilities);
    const project = projectContextTypeRows(caps, rows);
    const defaults = project.filter((r) => r.entry.includes('default'));
    if (defaults.length !== 1) {
      throw new ContextTypeRegistryError(
        type.slug,
        `expected exactly one value with entry "default", found ${defaults.length} (${defaults.map((r) => r.value).join(', ') || 'none'})`,
      );
    }
    const consultations = project.filter((r) => r.entry.includes('consultation'));
    if (consultations.length > 1) {
      throw new ContextTypeRegistryError(
        type.slug,
        `expected at most one value with entry "consultation", found ${consultations.map((r) => r.value).join(', ')}`,
      );
    }
    for (const row of consultations) {
      const classes = row.operationClasses === 'all' ? ALL_OPERATION_CLASSES : row.operationClasses;
      const outside = classes.filter((c) => c !== 'read' && c !== 'plan');
      if (outside.length > 0) {
        throw new ContextTypeRegistryError(
          type.slug,
          `consultation value "${row.value}" admits operation classes outside {read, plan}: ${outside.join(', ')}`,
        );
      }
      if (row.servers.includes(CONSULTATION_SERVER)) {
        throw new ContextTypeRegistryError(
          type.slug,
          `consultation value "${row.value}" names the consultation server ${CONSULTATION_SERVER}`,
        );
      }
      if (row.posture.kind === 'follow-thread') {
        throw new ContextTypeRegistryError(
          type.slug,
          `consultation value "${row.value}" has a posture that follows the thread flag; it must be pinned or unavailable`,
        );
      }
    }
    for (const row of project) {
      const decl = row.promptComposition;
      if (decl !== 'default' && (!Array.isArray(decl.own) || decl.own.length === 0)) {
        throw new ContextTypeRegistryError(type.slug, `value "${row.value}" declares an own composition with no recipe`);
      }
    }
  }
}
