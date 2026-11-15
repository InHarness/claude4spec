import type { ContextTypeShellRow } from '../../shared/context-type-shell.js';

/**
 * 2.1.88 (M53 `64xb1u7b`, L15 `6jkqb2h4`) — the artifact link of the bar above
 * the composer, decided by the thread value's ROW of the project registry, never
 * by a list of values written here.
 *
 * - The bar renders when the row's `Wątek` column names an artifact AND the
 *   thread carries it (the column's value on the thread is set).
 * - Its label comes from the artifact kind that column belongs to (M36
 *   `artifactRegistry`), e.g. kind `plan` → `Plan: …` — not from per-type strings.
 * - `Wątek: —`, a value the shell does not know (no row in the project registry,
 *   or the registry not read yet) and a thread without the artifact → no bar.
 *
 * ASSUMPTION:chat-shell-by-row-bar-one-column: one bar, the artifact of the row's
 * `Wątek` column only — a plan attached to a thread whose row names another column
 * (e.g. a `patch` thread) gets no bar of its own, and `ask` (`Wątek: —`) none.
 */
export interface ContextLinkThread {
  contextType: string;
  planPath?: string | null;
  briefPath?: string | null;
  patchPath?: string | null;
}

export interface ContextLink {
  /** The artifact kind (M36), e.g. `plan`, `brief`, `patch`. */
  kind: string;
  /** The `chat_thread` column the row's `Wątek` names. */
  column: string;
  /** The artifact's path, as the thread carries it. */
  path: string;
}

/** The thread's value of a `chat_thread` reference column, in the client's camelCase shape. */
function threadColumnValue(thread: ContextLinkThread, column: string): string | null {
  const key = column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof ContextLinkThread;
  const v = thread[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

/** The row of the project registry for the thread's value, or `null` when the shell does not know it. */
export function rowOfThread(
  thread: Pick<ContextLinkThread, 'contextType'> | null | undefined,
  rows: readonly ContextTypeShellRow[] | undefined,
): ContextTypeShellRow | null {
  if (!thread || !rows) return null;
  return rows.find((r) => r.value === thread.contextType) ?? null;
}

export function contextLinkOf(
  thread: ContextLinkThread | null | undefined,
  rows: readonly ContextTypeShellRow[] | undefined,
): ContextLink | null {
  const row = rowOfThread(thread, rows);
  if (!thread || !row?.thread) return null;
  const path = threadColumnValue(thread, row.thread.column);
  return path ? { kind: row.thread.artifactKind, column: row.thread.column, path } : null;
}

/** The bar's label prefix: the artifact kind's name (`plan` → `Plan`). */
export function artifactKindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The bar's text: `<Kind>: <title>`, the file name without `.md` when the
 * artifact has no title, and `<Kind> not found (moved or deleted)` for a
 * dangling reference (M36 `danglingPolicy`).
 */
export function contextLinkLabel(link: ContextLink, title: string | null | undefined, missing = false): string {
  const kind = artifactKindLabel(link.kind);
  if (missing) return `${kind} not found (moved or deleted)`;
  const name = (typeof title === 'string' && title.trim()) || link.path.replace(/\.md$/, '');
  return `${kind}: ${name}`;
}
