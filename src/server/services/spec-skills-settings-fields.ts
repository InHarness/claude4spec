import fs from 'node:fs';
import path from 'node:path';
import { builtinRoot, DEFAULT_SKILL_ENTRY } from '../config.js';
import type { CrossFieldRule, FieldDeclaration } from '../settings/field-registry.js';
import { formatLegalContextTypes, isKnownContextType } from './chat-context.js';

/**
 * 2.1.9 — the `skill.*` keys, declared by the spec-skills module (M52 L17
 * `wqvq1esb`): the project as a skill of its workspace, and its attachments.
 *
 * | key | effect | note |
 * |---|---|---|
 * | `skill.exposed` | `new-thread` | consumers see it from their next thread |
 * | `skill.name` | `new-thread` | kebab-case; required when exposed (cross-field) |
 * | `skill.description` | `new-thread` | non-empty when exposed (cross-field) |
 * | `skill.entry` | `per-operation` | an existing page of the base root; read per load |
 * | `skill.scope` | `new-thread` | `writing-style` \| `contextual` |
 * | `skill.contextTypes` | `new-thread` | a subset of the context-type enumeration |
 * | `skill.uses` | `new-thread` | names; a dangling or ambiguous one is NOT a validation error |
 *
 * None locks a resume, all are API-writable. The keys never ride in a release
 * bundle: the bundle's config is an allow-list that does not name them.
 */

const OWNER = 'spec-skills';
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SPEC_SKILLS_SETTINGS_FIELDS: FieldDeclaration[] = [
  {
    key: 'skill.exposed',
    owner: OWNER,
    type: 'boolean',
    default: false,
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'skill.name',
    owner: OWNER,
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
    key: 'skill.scope',
    owner: OWNER,
    type: { enum: ['writing-style', 'contextual'] },
    default: 'contextual',
    effect: 'new-thread',
    resumeLock: false,
    apiWritable: true,
  },
  {
    key: 'skill.contextTypes',
    owner: OWNER,
    type: 'string[]',
    default: ['chat', 'brief', 'patch', 'ask'],
    validate: (value) => {
      const bad = (value as string[]).filter((t) => !isKnownContextType(t));
      return bad.length > 0
        ? { ok: false, error: `skill.contextTypes: unknown context type ${bad.map((b) => `"${b}"`).join(', ')}; ${formatLegalContextTypes()}` }
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

/**
 * An exposed project needs an address and a reason to be opened: `skill.name`
 * and a non-empty `skill.description` are required while `skill.exposed` is on.
 * Checked on the EFFECTIVE post-write config, only when the request touches one
 * of the three.
 */
export const SKILL_EXPOSURE_RULE: CrossFieldRule = {
  owner: OWNER,
  id: 'skill-exposure-required-fields',
  touches: ['skill.exposed', 'skill.name', 'skill.description'],
  check: (effective) => {
    if (effective('skill.exposed') !== true) return { ok: true };
    const name = effective('skill.name');
    if (typeof name !== 'string' || name.trim() === '') {
      return { ok: false, key: 'skill.name', error: 'skill.name is required while the project is exposed as a skill' };
    }
    const description = effective('skill.description');
    if (typeof description !== 'string' || description.trim() === '') {
      return { ok: false, key: 'skill.description', error: 'skill.description must not be empty while the project is exposed as a skill' };
    }
    return { ok: true };
  },
};
