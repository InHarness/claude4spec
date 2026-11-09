/**
 * 2.1.77 — M57 `Project Type (L20)`, the layer's runtime (how-mode).
 *
 * The project-type registry is the SUM of the type modules' entries, registered
 * statically in host code (M57 `5j5aunoy`); its order is the registration order.
 * It is built at process start, AFTER the capability registry, and every entry
 * is validated there (M57 `91ci7cqx`):
 *
 *  - the slug is unique and kebab-case;
 *  - every capability of the set is declared in the capability registry (and the
 *    set is closed under dependencies — L19 `rgkqgr2b`);
 *  - every type key is declared in the project settings layer, and the
 *    capabilities it requires fit in the type's set;
 *  - every type step writes type keys only, and a step replacing a common step
 *    writes every key of the replaced step;
 *  - the starter-content template's placeholders name common onboarding keys or
 *    type keys.
 *
 * A violation stops the server start with `PROJECT_TYPE_REGISTRY_INVALID`. There
 * is no runtime check (the final onboarding write is common and does not know
 * which step fed it).
 *
 * The entry is handed out (M57 `y7od19e7`) as: the type list (slug, name, user
 * description) for the create-project page; the capability set and starter
 * content for activation; onboarding steps and type keys for the wizard; the
 * prompt description for the `<project_type>` prompt block.
 */
import type { FieldRegistry } from '../settings/field-registry.js';
import { buildFieldRegistry } from '../settings/registry.js';
import type { ProjectTypeCard } from '../../shared/project-types.js';
import { ProjectTypeRegistryError, hostCapabilityRegistry, type CapabilityRegistry } from './capabilities.js';
import { HOST_PROJECT_TYPE_ENTRIES } from './entries.js';
import {
  COMMON_ONBOARDING_STEPS,
  type CommonOnboardingStep,
  type ProjectTypeOnboarding,
} from '../../shared/onboarding-steps.js';

/**
 * 2.1.77 (M16 `czn353hw`, L20 `Onboarding typu`): the wizard's common steps and
 * the type-step model are shared with the wizard frame in the browser.
 */
export {
  COMMON_ONBOARDING_STEPS,
  type CommonOnboardingStep,
  type ProjectTypeOnboarding,
  type ProjectTypeStep,
} from '../../shared/onboarding-steps.js';

/** L20 `Zawartość startowa`. */
export interface ProjectTypeStarterContent {
  /** The starter page, relative to the base root. */
  path: string;
  /** The template, verbatim; `{key}` placeholders name onboarding keys. */
  template: string;
  /** Keys the activation sets to a value pointing at this page. */
  entryKeys: readonly string[];
}

/** One entry of the type registry — the L20 schema, nothing more (M57 `gd3ct7xo`). */
export interface ProjectTypeEntry {
  /** Kebab-case, immutable after the first release; the `projectType` value. */
  slug: string;
  /** Literal English name, shown on the type card and in labels. */
  name: string;
  /** Literal English description for the user (the type card). */
  description: string;
  /** The text the `<project_type>` prompt block gives the agent verbatim. */
  promptDescription: string;
  /** Capability names; an empty list is valid. */
  capabilities: readonly string[];
  onboarding: ProjectTypeOnboarding | null;
  starterContent: ProjectTypeStarterContent | null;
}

export interface ProjectTypeRegistryDeps {
  capabilities: CapabilityRegistry;
  /** The project settings layer — the declared config keys and their `requires`. */
  fields: FieldRegistry;
  commonSteps?: readonly CommonOnboardingStep[];
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER = /\{([A-Za-z][\w.-]*)\}/g;

/** The validated project-type registry. Immutable after construction. */
export class ProjectTypeRegistry {
  private readonly entries: readonly ProjectTypeEntry[];
  private readonly bySlug: ReadonlyMap<string, ProjectTypeEntry>;

  constructor(entries: readonly ProjectTypeEntry[]) {
    this.entries = Object.freeze([...entries]);
    this.bySlug = new Map(entries.map((e) => [e.slug, e]));
  }

  has(slug: string): boolean {
    return this.bySlug.has(slug);
  }

  get(slug: string): ProjectTypeEntry | undefined {
    return this.bySlug.get(slug);
  }

  /** Every entry, in registry order. */
  list(): ProjectTypeEntry[] {
    return [...this.entries];
  }

  /** The type list for the create-project page: slug, name, user description. */
  cards(): ProjectTypeCard[] {
    return this.entries.map((e) => ({ slug: e.slug, name: e.name, description: e.description }));
  }
}

function validateEntry(
  entry: ProjectTypeEntry,
  deps: Required<ProjectTypeRegistryDeps>,
): void {
  const fail = (message: string): never => {
    throw new ProjectTypeRegistryError(entry.slug, message);
  };
  if (!KEBAB.test(entry.slug)) fail('project-type slug is not kebab-case');

  // Capabilities: declared and closed under dependencies (L19).
  deps.capabilities.assertTypeCapabilities(entry.slug, entry.capabilities);
  const typeSet = new Set(entry.capabilities);

  const typeKeys = new Set(entry.onboarding?.typeKeys ?? []);
  for (const key of typeKeys) {
    const field = deps.fields.get(key);
    if (!field) fail(`onboarding key "${key}" is not declared in the project settings layer`);
    for (const c of field!.requires ?? []) {
      if (!typeSet.has(c)) {
        fail(`onboarding key "${key}" requires capability "${c}", which the type's set does not contain`);
      }
    }
  }

  const common = new Map(deps.commonSteps.map((s) => [s.name, s]));
  for (const step of entry.onboarding?.steps ?? []) {
    if (!common.has(step.position.commonStep)) {
      fail(`step "${step.title}" is placed relative to unknown common step "${step.position.commonStep}"`);
    }
    for (const key of step.writes) {
      if (!typeKeys.has(key)) fail(`step "${step.title}" writes "${key}", which is not a type key`);
    }
    if (step.replaces !== null) {
      const replaced = common.get(step.replaces);
      if (!replaced) fail(`step "${step.title}" replaces unknown common step "${step.replaces}"`);
      for (const key of replaced!.writes) {
        if (!step.writes.includes(key)) {
          fail(`step "${step.title}" replaces "${step.replaces}" but does not write its key "${key}"`);
        }
      }
    }
  }

  if (entry.starterContent) {
    const commonKeys = new Set(deps.commonSteps.flatMap((s) => s.writes));
    for (const m of entry.starterContent.template.matchAll(PLACEHOLDER)) {
      const key = m[1]!;
      if (!commonKeys.has(key) && !typeKeys.has(key)) {
        fail(`starter-content placeholder "{${key}}" names neither a common onboarding key nor a type key`);
      }
    }
  }
}

/**
 * Builds and validates the project-type registry. Throws
 * {@link ProjectTypeRegistryError} (code `PROJECT_TYPE_REGISTRY_INVALID`) naming
 * the faulty entry's slug.
 */
export function buildProjectTypeRegistry(
  entries: readonly ProjectTypeEntry[],
  deps: ProjectTypeRegistryDeps,
): ProjectTypeRegistry {
  const full: Required<ProjectTypeRegistryDeps> = { commonSteps: COMMON_ONBOARDING_STEPS, ...deps };
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.slug)) {
      throw new ProjectTypeRegistryError(entry.slug, 'two project-type entries carry this slug');
    }
    seen.add(entry.slug);
    validateEntry(entry, full);
  }
  return new ProjectTypeRegistry(entries);
}

/**
 * The host's project-type registry — built once per process, after the
 * capability registry. A faulty entry throws and the server does not start.
 */
let hostRegistry: ProjectTypeRegistry | null = null;
export function hostProjectTypeRegistry(): ProjectTypeRegistry {
  hostRegistry ??= buildProjectTypeRegistry(HOST_PROJECT_TYPE_ENTRIES, {
    capabilities: hostCapabilityRegistry(),
    fields: buildFieldRegistry(),
  });
  return hostRegistry;
}
