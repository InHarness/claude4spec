import fs from 'node:fs';
import path from 'node:path';
import { builtinRoot, DEFAULT_SKILL_ENTRY } from '../config.js';
import type { FieldDeclaration } from '../settings/field-registry.js';
import { KNOWN_CONTEXT_TYPES } from './chat-context.js';
import { SKILL_NAME_RE } from './skill-name.js';
import { SKILL_EXPOSURE_CAPABILITY } from '../project-types/capabilities.js';

/**
 * 2.1.9 — the `skill.*` keys, declared by the spec-skills module (M52 L17
 * `wqvq1esb`): the project as a skill of its workspace, and its attachments.
 *
 * | key | effect | requires | note |
 * |---|---|---|---|
 * | `skill.name` | `new-thread` | `skill-exposure` | kebab-case; absent is no error |
 * | `skill.description` | `new-thread` | `skill-exposure` | non-empty; absent is no error |
 * | `skill.entry` | `per-operation` | `skill-exposure` | an existing page of the base root; read per load |
 * | `skill.contextTypes` | `new-thread` | `skill-exposure` | a subset of the project registry's context types; default all of them |
 * | `skill.uses` | `new-thread` | — | names; a dangling or ambiguous one is NOT a validation error |
 *
 * None locks a resume, all are API-writable.
 *
 * 2.1.77 (M52 `0ay8qh6u`, `ybbal0vf`): a project is a provider by its type's
 * capability `skill-exposure`, exposed from founding — the exposure toggle
 * (`skill.exposed`) and the scope choice (`skill.scope`, the scope follows from
 * the provider's type) are gone with their keys, and so is the cross-field rule
 * that required a name and a description while exposed: a provider without
 * them is simply no listing entry. Without `skill-exposure` the four exposure
 * keys are inactive: GET does not return them, PATCH skips them, and the file
 * keeps them untouched (M26 `hozcm4w5`).
 */

const OWNER = 'spec-skills';

/**
 * The documentary default of `skill.contextTypes`: every value of the project's
 * context-type registry (M52 `wqvq1esb`). The file keeps the key absent.
 */
export const ALL_REGISTRY_VALUES = 'all values of the project context type registry';
const KEBAB = SKILL_NAME_RE;

export const SPEC_SKILLS_SETTINGS_FIELDS: FieldDeclaration[] = [
  {
    key: 'skill.name',
    owner: OWNER,
    requires: [SKILL_EXPOSURE_CAPABILITY.name],
    type: 'string|null',
    default: null,
    validate: (value) => {
      if (value === null) return { ok: true };
      const v = String(value).trim();
      if (v === '') return { ok: true, value: null };
      return KEBAB.test(v)
        ? { ok: true, value: v }
        : { ok: false, error: `skill.name "${v}" must be kebab-case (lowercase letters, digits and single hyphens)` };
    },
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'skill.description',
    owner: OWNER,
    requires: [SKILL_EXPOSURE_CAPABILITY.name],
    type: 'string|null',
    default: null,
    validate: (value) => {
      if (value === null) return { ok: true };
      const v = String(value).trim();
      return { ok: true, value: v === '' ? null : v };
    },
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'skill.entry',
    owner: OWNER,
    requires: [SKILL_EXPOSURE_CAPABILITY.name],
    type: 'string|null',
    default: DEFAULT_SKILL_ENTRY,
    validate: (value, ctx) => {
      if (value === null || String(value).trim() === '') return { ok: true, value: null };
      const v = String(value).trim();
      const segments = v.split('/');
      if (path.isAbsolute(v) || v.includes('\\') || segments.some((s) => s === '..' || s === '' || s === '.')) {
        return { ok: false, error: `skill.entry "${v}" must be a page path inside the base root, e.g. "${DEFAULT_SKILL_ENTRY}"` };
      }
      let base;
      try {
        base = builtinRoot(ctx.effectiveRoots);
      } catch {
        return { ok: false, error: 'skill.entry cannot be checked: the project has no base root' };
      }
      const abs = path.join(ctx.cwd, base.dir, v);
      return fs.existsSync(abs) && fs.statSync(abs).isFile()
        ? { ok: true, value: v }
        : { ok: false, error: `skill.entry "${v}" is not a page of the base root "${base.id}"` };
    },
    effect: 'per-operation',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'skill.contextTypes',
    owner: OWNER,
    requires: [SKILL_EXPOSURE_CAPABILITY.name],
    type: 'string[]',
    /**
     * 2.1.88 (M52 `wqvq1esb`) — every value of the project's context-type
     * registry. Not a literal list: an absent key is the default, and the reader
     * (`project-exposed-skills.ts`) takes it as "every value of the registry the
     * skill is listed in", judged against the current registry.
     */
    default: ALL_REGISTRY_VALUES,
    validate: (value, ctx) => {
      // A subset of the project registry's values — a Host API value the project lacks is unknown here.
      const legal = ctx.contextTypes ?? KNOWN_CONTEXT_TYPES;
      const bad = (value as string[]).filter((t) => !legal.includes(t));
      return bad.length > 0
        ? {
            ok: false,
            error: `skill.contextTypes: unknown context type ${bad.map((b) => `"${b}"`).join(', ')}; expected one of ${legal.join(', ')} (this project's context type registry)`,
          }
        : { ok: true, value: [...new Set(value as string[])] };
    },
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'skill.uses',
    owner: OWNER,
    type: 'string[]',
    default: [],
    // A dangling or ambiguous name is a warning at read time, never a refusal here:
    // a change in someone else's project must not make this one unsavable.
    validate: (value) => ({
      ok: true,
      value: [...new Set((value as string[]).map((n) => n.trim()).filter((n) => n !== ''))],
    }),
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
];
