import { parseRootsArray } from '../config.js';
import { retiredRootIds } from '../root-renames.js';
import { SUPPORTED_LANGUAGES, isSupportedLanguage } from '../../shared/languages.js';
import type { FieldDeclaration } from '../settings/field-registry.js';

/**
 * 0.2.113 — config fields the PROJECT module answers for: its identity (name,
 * description, spec language), its page roots, and the onboarding flag.
 *
 * `roots[]` is a full-array replace: a write is a delete+create, never a rename —
 * the only way an `id` changes is `POST /config/roots/:rootId/rename`.
 */
export const PROJECT_SETTINGS_FIELDS: FieldDeclaration[] = [
  {
    key: 'name',
    owner: 'project',
    type: 'string',
    default: '',
    // 0.1.91 — name is display-only (folder identity is sha1(cwd), not the name),
    // so full Unicode is allowed; reject only C0/DEL/C1 control chars + newline/tab.
    validate: (value) => {
      const trimmed = (value as string).trim();
      if (trimmed.length < 1 || trimmed.length > 80 || /[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) {
        return { ok: false, error: 'name: 1-80 chars, no line breaks or control characters' };
      }
      return { ok: true, value: trimmed };
    },
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'description',
    owner: 'project',
    type: 'string|null',
    default: null,
    // 0.1.58: local "elevator pitch" (0–200). `null` or an empty/whitespace string
    // clears it. Distinct from the remote project.description (no sync).
    validate: (value) => {
      if (typeof value === 'string' && value.length > 200) {
        return { ok: false, error: 'description must be at most 200 characters' };
      }
      const trimmed = typeof value === 'string' ? value.trim() : null;
      return { ok: true, value: trimmed ? value : null };
    },
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'language',
    owner: 'project',
    type: 'string|null',
    default: null,
    validate: (value) =>
      value !== null && !isSupportedLanguage(value)
        ? {
            ok: false,
            error: `language "${String(value)}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}`,
          }
        : { ok: true },
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'roots',
    owner: 'project',
    type: 'object',
    default: [],
    // Structural validation (types, path safety, unique ids, dangling linkTargets,
    // built-in root present). Rule 7: an identifier an earlier rename retired must
    // not come back through a full-array write either.
    validate: (value, ctx) => {
      try {
        return { ok: true, value: parseRootsArray(value, { retiredIds: retiredRootIds(ctx.cwd) }) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    effect: 'context-rebuild',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'onboardingCompleted',
    owner: 'project',
    type: 'boolean',
    // A fresh project gets `false` from the bootstrap; a file without the key is an
    // existing project and counts as onboarded.
    default: true,
    effect: 'per-operation',
    resumeLock: false,
    apiWritable: true,
  },
];
