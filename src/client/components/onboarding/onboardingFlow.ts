import type { ConfigPatch, ConfigResponse } from '../../lib/api.js';

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
  /** The base root's directory as edited in "Advanced". */
  pagesDir: string;
  /** The base root's identifier as edited in "Advanced". */
  rootId: string;
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
  | { ok: false; aborted: true };

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
 * Errors of the PATCH itself propagate to the caller (a toast).
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
  const nextDir = form.pagesDir.trim();
  if (baseAfter && nextDir !== baseAfter.dir) {
    body.roots = current.roots.map((r) => (r.builtin ? { ...r, dir: nextDir } : r));
  }
  await deps.patchConfig(body);
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
