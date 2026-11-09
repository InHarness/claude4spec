import type { ConfigPatch, ConfigResponse } from '../../lib/api.js';
import { ApiError } from '../../lib/api-core.js';

/**
 * M16 — the two submits of the onboarding form, as plain functions over injected
 * effects, so the order that is the contract can be read (and checked) without a
 * browser. `OnboardingPage` wires them to the real mutations, modal and router.
 */

/** The shell's gate: a project whose onboarding is not closed lands on `/onboarding`. */
export function needsOnboarding(config: Pick<ConfigResponse, 'onboarding'>): boolean {
  return !config.onboarding.completed;
}

export interface OnboardingForm {
  name: string;
  writingStyle: string | null;
  language: string | null;
  conversationalLanguage: string | null;
  /** The base root's directory as edited in the `Pages directory` step. */
  pagesDir: string;
  /** The base root's identifier as edited in the `Pages directory` step. */
  rootId: string;
  /**
   * 2.1.77 (M16 `czn353hw`): the values the TYPE steps collected, by dotted
   * config key (`skill.name`). They ride the same final write as the common
   * values. Absent/empty for a type without steps.
   */
  typeValues?: Readonly<Record<string, unknown>>;
}

export interface SubmitOnboardingDeps {
  config: ConfigResponse;
  renameRoot: (input: { rootId: string; newId: string; expectedConfigHash: string }) => Promise<unknown>;
  /** Re-read the config after a rename (new `configHash`, new identifier). */
  refetchConfig: () => Promise<ConfigResponse | undefined>;
  patchConfig: (body: ConfigPatch) => Promise<unknown>;
  navigate: (to: '/') => void;
}

export type SubmitOnboardingResult =
  | { ok: true }
  /** The rename was refused: the message belongs under the Root ID field; nothing else was sent. */
  | { ok: false; rootIdError: string }
  /**
   * 2.1.77 (M16 `r2q6o6vi`): the final write was refused for a named key — the
   * wizard moves to the step collecting it and shows the message under its field.
   * Nothing was written (the write is atomic), so onboarding is not closed.
   */
  | { ok: false; fieldError: { key: string; message: string } }
  | { ok: false; aborted: true };

/** Places a dotted key's value into the body as nested objects (`skill.name` → `{ skill: { name } }`). */
function setDotted(body: Record<string, unknown>, key: string, value: unknown): void {
  const segs = key.split('.');
  let cur = body;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    cur = cur[seg] = next && typeof next === 'object' && !Array.isArray(next) ? (next as Record<string, unknown>) : {};
  }
  cur[segs[segs.length - 1]!] = value;
}

/**
 * [Continue] is TWO steps since 0.2.101, and their ORDER IS THE CONTRACT:
 * rename first, re-read the config, then PATCH the rest built from what came
 * back.
 *
 * - A REFUSED RENAME ABORTS THE SUBMIT. `onboardingCompleted: true` is never
 *   sent and the user stays on the form, with the message under the Root ID
 *   field. Since onboarding did not close, no welcome `index.md` is written.
 * - A SECOND ATTEMPT READS STATE AFRESH. The refetched config carries a new
 *   `configHash` and the current id; a rename that succeeded but whose response
 *   was lost comes back `alreadyApplied` and migrates nothing twice.
 * - THE DIRECTORY WRITE IS COMPOSED FROM THE REFRESHED CONFIG, so its
 *   full-array `roots` cannot overwrite the identifier that was just changed.
 *   `roots` is sent only when the base root's directory actually changed: the
 *   full array with nothing but the `builtin` entry's `dir` swapped.
 *
 * 2.1.77: the type steps' values join the SAME body. A refusal that names a key
 * (`error.details.field`) comes back as `fieldError`; any other error of the
 * PATCH propagates to the caller (the standard mutation-error path).
 */
export async function submitOnboarding(form: OnboardingForm, deps: SubmitOnboardingDeps): Promise<SubmitOnboardingResult> {
  let current = deps.config;
  const baseRoot = current.roots.find((r) => r.builtin);
  const nextId = form.rootId.trim();
  if (baseRoot && nextId !== baseRoot.id) {
    try {
      await deps.renameRoot({ rootId: baseRoot.id, newId: nextId, expectedConfigHash: current.configHash });
    } catch (e) {
      return { ok: false, rootIdError: (e as Error).message };
    }
    const refetched = await deps.refetchConfig();
    if (!refetched) return { ok: false, aborted: true };
    current = refetched;
  }

  const baseAfter = current.roots.find((r) => r.builtin);
  const body: ConfigPatch = {
    name: form.name.trim(),
    writingStyle: form.writingStyle,
    language: form.language,
    agent: { conversationalLanguage: form.conversationalLanguage }, // deep-merged server-side
    onboardingCompleted: true,
  };
  for (const [key, value] of Object.entries(form.typeValues ?? {})) {
    setDotted(body as Record<string, unknown>, key, typeof value === 'string' ? value.trim() : value);
  }
  const nextDir = form.pagesDir.trim();
  if (baseAfter && nextDir !== baseAfter.dir) {
    body.roots = current.roots.map((r) => (r.builtin ? { ...r, dir: nextDir } : r));
  }
  try {
    await deps.patchConfig(body);
  } catch (e) {
    const field = e instanceof ApiError ? e.details?.details : undefined;
    const key = field && typeof field === 'object' ? (field as { field?: unknown }).field : undefined;
    if (typeof key === 'string' && key.length > 0) {
      return { ok: false, fieldError: { key, message: (e as Error).message } };
    }
    throw e;
  }
  deps.navigate('/');
  return { ok: true };
}

export interface SkipOnboardingDeps {
  /** Opens the skip ConfirmModal; resolves to the user's answer. */
  confirm: () => Promise<boolean>;
  patchConfig: (body: ConfigPatch) => Promise<unknown>;
  navigate: (to: '/') => void;
}

/**
 * [Skip] keeps the path light: after the ConfirmModal it sends ONLY
 * `onboardingCompleted: true` — no `name`, `writingStyle`, `language`, `agent`,
 * no `roots` and no rename — so the base root keeps its bootstrap directory and
 * identifier, and both languages stay `null`.
 */
export async function skipOnboarding(deps: SkipOnboardingDeps): Promise<boolean> {
  if (!(await deps.confirm())) return false;
  await deps.patchConfig({ onboardingCompleted: true });
  deps.navigate('/');
  return true;
}
