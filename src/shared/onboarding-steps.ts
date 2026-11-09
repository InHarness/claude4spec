/**
 * 2.1.77 — the onboarding wizard's step model, shared by the project-type
 * registry (server: M57 entry validation) and the wizard frame (client: M16).
 *
 * - The four COMMON steps belong to M16 (`czn353hw`), in this order: `Project
 *   name`, `Writing style`, `Languages`, `Pages directory`; each names the
 *   config keys it collects.
 * - A TYPE step is a row of a type entry's step table (L20 `Onboarding typu`):
 *   its component, its position relative to the common steps, the keys it
 *   writes and the common step it replaces. The wizard composes its list from
 *   the entry alone ({@link composeWizardSteps}) — it never branches on a slug.
 *
 * The type entries' step tables live here as data ({@link PROJECT_TYPE_ONBOARDING})
 * because a step's component is a browser component the server registry cannot
 * carry; the server entries (src/server/project-types/entries.ts) take their
 * `onboarding` field from this table, so there is one source.
 */

/** A common step of the onboarding wizard: its name and the keys it writes. */
export interface CommonOnboardingStep {
  name: string;
  writes: readonly string[];
}

/** M16 `czn353hw` — the common steps, in wizard order. */
export const COMMON_ONBOARDING_STEPS: readonly CommonOnboardingStep[] = [
  { name: 'Project name', writes: ['name'] },
  { name: 'Writing style', writes: ['writingStyle'] },
  { name: 'Languages', writes: ['language', 'agent.conversationalLanguage'] },
  // The directory rides the final write as `roots`; the identifier is changed by
  // the rename operation, never a key of this write (`gipdzz10`).
  { name: 'Pages directory', writes: ['roots'] },
];

/** One row of a type's step table (L20 `Onboarding typu`). */
export interface ProjectTypeStep {
  /** `Krok` — the step's title, a literal English string. */
  title: string;
  /** The browser component that collects the step's values (M16: "każdy niesie komponent"). */
  component: string;
  /** `Pozycja względem kroków wspólnych` — `przed <krok>` / `po <krok>`. */
  position: { relation: 'before' | 'after'; commonStep: string };
  /** `Zapisywane klucze` — a subset of the type keys. */
  writes: readonly string[];
  /** `Podmienia krok wspólny` — the replaced common step, or `null` for `—`. */
  replaces: string | null;
}

/** L20 `Onboarding typu`; `null` for `— brak` (the common steps only). */
export interface ProjectTypeOnboarding {
  /** Config keys the type's steps may write. */
  typeKeys: readonly string[];
  steps: readonly ProjectTypeStep[];
}

/** M59 `wt5a7bbe` — Skill: `Skill details` after `Project name`. */
export const SKILL_ONBOARDING: ProjectTypeOnboarding = {
  typeKeys: ['skill.name', 'skill.description'],
  steps: [
    {
      title: 'Skill details',
      component: 'skill-details',
      position: { relation: 'after', commonStep: 'Project name' },
      writes: ['skill.name', 'skill.description'],
      replaces: null,
    },
  ],
};

/** M60 `usl75l6i` — Writing Style: `Style details` after `Project name`. */
export const WRITING_STYLE_ONBOARDING: ProjectTypeOnboarding = {
  typeKeys: ['skill.name', 'skill.description'],
  steps: [
    {
      title: 'Style details',
      component: 'style-details',
      position: { relation: 'after', commonStep: 'Project name' },
      writes: ['skill.name', 'skill.description'],
      replaces: null,
    },
  ],
};

/**
 * The `onboarding` field of each host type entry, keyed by the entry's slug
 * (a key of the entry, never a branch). M58 `7yg36c76`: Specification is `— brak`.
 */
export const PROJECT_TYPE_ONBOARDING: Readonly<Record<string, ProjectTypeOnboarding | null>> = {
  spec: null,
  skill: SKILL_ONBOARDING,
  'writing-style': WRITING_STYLE_ONBOARDING,
};

/** One step of the composed wizard. */
export type WizardStep =
  | { kind: 'common'; title: string; writes: readonly string[] }
  | { kind: 'type'; title: string; writes: readonly string[]; component: string };

/**
 * M16 `czn353hw` — the wizard's step list: the common steps in their order,
 * with the entry's type steps inserted by position (two at the same position
 * keep the entry's order) and every common step a type step replaces left out
 * (its keys are collected by the replacing step). A type without steps gets the
 * common steps only.
 */
export function composeWizardSteps(
  onboarding: ProjectTypeOnboarding | null | undefined,
  common: readonly CommonOnboardingStep[] = COMMON_ONBOARDING_STEPS,
): WizardStep[] {
  const typeSteps = onboarding?.steps ?? [];
  const replaced = new Set(typeSteps.map((s) => s.replaces).filter((r): r is string => r !== null));
  const typeAt = (relation: 'before' | 'after', name: string): WizardStep[] =>
    typeSteps
      .filter((s) => s.position.relation === relation && s.position.commonStep === name)
      .map((s) => ({ kind: 'type', title: s.title, writes: s.writes, component: s.component }));
  const out: WizardStep[] = [];
  for (const c of common) {
    out.push(...typeAt('before', c.name));
    if (!replaced.has(c.name)) out.push({ kind: 'common', title: c.name, writes: c.writes });
    out.push(...typeAt('after', c.name));
  }
  return out;
}

/**
 * M16 `r2q6o6vi` — the step that collects `key` (a refusal's field), or -1.
 * A refusal may name a sub-path of a key (`roots[0].dir` → `roots`).
 */
export function stepIndexForKey(steps: readonly WizardStep[], key: string): number {
  return steps.findIndex((s) =>
    s.writes.some((w) => key === w || key.startsWith(`${w}.`) || key.startsWith(`${w}[`)),
  );
}
