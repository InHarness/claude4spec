import { SUPPORTED_LANGUAGES } from '../../../shared/languages.js';
import { validateName } from '../onboarding/NameField.js';
import { EFFECT, type SettingsContribution, type SettingsElementDecl } from '../settings/registry.js';
import { RootsElement } from './RootsElement.js';
import { RESERVED_WRITE_TARGETS, isPathSafeRelative, normDir, rootOverlapsDir, targetsNest } from './dirOverlap.js';

/**
 * 0.2.113 — what the PROJECT module declares on `/settings`: the Project card
 * (identity: name, description, spec language) and the Directories card with its
 * Roots element. The five artifact-directory fields on that card are declared by
 * the modules whose files live there — see `ARTIFACT_DIR_ELEMENTS`.
 */
export const PROJECT_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'project',
      title: 'Project',
      description: 'Name shown in the sidebar and used as the remote project label on first push.',
      group: 'Project',
      weight: 10,
      owner: 'project',
    },
    {
      anchor: 'directories',
      title: 'Directories',
      description: 'Page roots and the directories the project keeps its artifacts in.',
      // The spec gives this card no group; it orders with the Project cards.
      group: 'Project',
      weight: 40,
      owner: 'project',
    },
  ],
  elements: [
    {
      id: 'name',
      card: 'project',
      weight: 10,
      kind: 'text',
      owner: 'project',
      configKey: ['name'],
      label: 'Name',
      maxLength: 80,
      help: '1–80 chars; any character except line breaks and control characters.',
      effectMessage: EFFECT.newThread,
      validate: (value) => {
        const err = validateName(typeof value === 'string' ? value : '');
        return err ? { error: err } : null;
      },
    },
    {
      id: 'description',
      card: 'project',
      weight: 20,
      kind: 'textarea',
      owner: 'project',
      configKey: ['description'],
      label: 'Description',
      maxLength: 200,
      emptyAsNull: true,
      placeholder: 'One-line elevator pitch for this specification…',
      help: 'Visible to agents of other workspace projects, to help them decide whom to consult.',
      effectMessage: EFFECT.newThread,
      validate: (value) =>
        typeof value === 'string' && value.length > 200 ? { error: 'At most 200 characters.' } : null,
    },
    {
      id: 'language',
      card: 'project',
      weight: 30,
      kind: 'select',
      owner: 'project',
      configKey: ['language'],
      label: 'Spec language',
      nullOption: 'None',
      help: 'The language the agent writes spec content in. Not the conversation language — set that on the Agent card.',
      effectMessage: EFFECT.newThread,
      useOptions: () => SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: l })),
    },
    {
      id: 'roots',
      card: 'directories',
      weight: 10,
      kind: 'custom',
      owner: 'project',
      keys: [['roots']],
      label: 'Roots',
      effectMessage: EFFECT.rebuild,
      component: RootsElement,
    },
  ],
};

type DirKey = 'plansDir' | 'briefsDir' | 'patchesDir' | 'entitiesDir' | 'releasesDir';
const ARTIFACT_DIRS: readonly DirKey[] = ['briefsDir', 'patchesDir', 'plansDir'];
const WRITE_TARGETS: readonly DirKey[] = ['entitiesDir', 'releasesDir'];

/**
 * The live half of the directory rules (the server re-validates on save):
 *  - relative, no `..`;
 *  - two of briefs/patches/plans equal → error;
 *  - overlapping entitiesDir, releasesDir or the plugin dir → error;
 *  - overlapping a page root → a warning only (frontmatter tells the files apart).
 */
function validateDir(field: DirKey): SettingsElementDecl['validate'] {
  return (value, { draft }) => {
    const v = typeof value === 'string' ? value : '';
    if (!isPathSafeRelative(v)) return { error: 'Must be a relative path inside the project.' };
    const dirOf = (k: DirKey) => String(draft.get([k]) ?? '');
    if (ARTIFACT_DIRS.includes(field)) {
      for (const other of ARTIFACT_DIRS) {
        if (other !== field && normDir(dirOf(other)) === normDir(v)) return { error: `${field} and ${other} must differ` };
      }
      for (const target of WRITE_TARGETS) {
        if (targetsNest(v, dirOf(target))) return { error: `Overlaps ${target}.` };
      }
    } else {
      for (const other of [...WRITE_TARGETS, ...ARTIFACT_DIRS]) {
        if (other !== field && targetsNest(v, dirOf(other))) return { error: `Overlaps ${other}.` };
      }
    }
    if (RESERVED_WRITE_TARGETS.some((t) => targetsNest(v, t))) return { error: 'Overlaps the plugin directory.' };
    const roots = (draft.get(['roots']) ?? []) as { id: string; dir: string }[];
    const hit = roots.find((r) => rootOverlapsDir(r.dir, v));
    if (hit) {
      return ARTIFACT_DIRS.includes(field)
        ? { warning: `Overlaps the page root '${hit.id}' — files are told apart by their frontmatter.` }
        : { error: `Overlaps the page root '${hit.id}'.` };
    }
    return null;
  };
}

const dirElement = (field: DirKey, label: string, owner: string, weight: number): SettingsElementDecl => ({
  id: field,
  card: 'directories',
  weight,
  kind: 'path',
  owner,
  configKey: [field],
  label,
  effectMessage: EFFECT.rebuildResumeBreak,
  validate: validateDir(field),
  help: 'Relocating a directory moves no files — move them by hand, or they drop out of the index.',
});

/** 0.2.113 — each artifact directory, declared by the module whose files live there. */
export const ARTIFACT_DIR_ELEMENTS: SettingsContribution = {
  elements: [
    dirElement('plansDir', 'Plans directory', 'plans', 20),
    dirElement('briefsDir', 'Briefs directory', 'briefs', 30),
    dirElement('patchesDir', 'Patches directory', 'patches', 40),
    dirElement('entitiesDir', 'Entities directory', 'entity-framework', 50),
    dirElement('releasesDir', 'Releases directory', 'releases', 60),
  ],
};
