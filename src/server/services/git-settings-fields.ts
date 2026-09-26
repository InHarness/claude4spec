import { isValidGitRefName } from './git.js';
import { renderCommitTargetTemplate, localDateYYYYMMDD } from '../../shared/git.js';
import type { CrossFieldRule, FieldDeclaration } from '../settings/field-registry.js';

/**
 * 0.2.113 — the `git.*` leaves, declared by the git-sync module. All of them are
 * `per-operation`: git settings are read per action, so a save acts on the next
 * release, pull or push.
 */
const gitField = (key: string, type: FieldDeclaration['type'], def: unknown): FieldDeclaration => ({
  key,
  owner: 'git-sync',
  type,
  default: def,
  effect: 'per-operation',
  resumeLock: false,
  apiWritable: true,
});

export const GIT_SETTINGS_FIELDS: FieldDeclaration[] = [
  gitField('git.enabled', 'boolean', false),
  gitField('git.syncPushOnPush', 'boolean', false),
  gitField('git.commitTarget.mode', { enum: ['current', 'named', 'new'] }, 'current'),
  gitField('git.commitTarget.branch', 'string|null', null),
  gitField('git.commitTarget.template', 'string|null', null),
  gitField('git.commitTarget.base', 'string|null', null),
  gitField('git.switchAfterRelease', 'boolean', false),
];

/**
 * 0.1.125: the active mode's companion field must be set, and a `new`-mode template
 * must render to a valid ref name. Checked against the EFFECTIVE post-merge target,
 * not the request alone — a PATCH carrying only `branch: null` must not persist
 * `{ mode: 'named', branch: null }` behind a saved mode it never mentioned.
 */
export const GIT_COMMIT_TARGET_RULE: CrossFieldRule = {
  owner: 'git-sync',
  id: 'git.commitTarget',
  touches: ['git.commitTarget.mode', 'git.commitTarget.branch', 'git.commitTarget.template', 'git.commitTarget.base'],
  check: async (effective) => {
    const mode = effective('git.commitTarget.mode');
    const branch = effective('git.commitTarget.branch');
    const template = effective('git.commitTarget.template');
    if (mode === 'named' && !branch) {
      return { ok: false, key: 'git.commitTarget.branch', error: "git.commitTarget.branch is required when mode is 'named'" };
    }
    if (mode === 'new') {
      if (!template) {
        return {
          ok: false,
          key: 'git.commitTarget.template',
          error: "git.commitTarget.template is required when mode is 'new'",
        };
      }
      // Ref-safe dummy release name for the preview render — a space (as in
      // "Preview Release") is itself an invalid ref character, which would fail
      // every template using the documented `{release_name}` placeholder.
      const preview = renderCommitTargetTemplate(template as string, {
        releaseName: 'preview-release',
        date: localDateYYYYMMDD(new Date()),
      });
      if (!(await isValidGitRefName(preview))) {
        return {
          ok: false,
          key: 'git.commitTarget.template',
          error: `git.commitTarget.template renders to an invalid branch name: "${preview}"`,
        };
      }
    }
    return { ok: true };
  },
};
