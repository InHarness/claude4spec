/**
 * 2.1.26 — the `mcp-tool` records of the M37 skill tools and the M31 workspace
 * tool, as the specification states them at release 2.1.26: the turn's
 * `skill-tools · load_skill_file`, the external `c4s-reader · load_skill_file`
 * and `c4s-reader · list_skills` (built by the same `buildSkillToolsServer`, seen
 * on the wire under `c4s-reader`), and `workspace-tools · list_projects`. Name,
 * server, the description the model reads, the declared parameters and the
 * annotation hints. Copied from the records, not from the code — the tests that
 * read this file hold the registered tools against it through the shared
 * `expectToolMatchesToolRecord` of `write-tool-records.ts`, and resolve a
 * `spec-operation` record's `narzedzia` to `<server>.<tool>` through it.
 */

import type { WriteToolRecord } from './write-tool-records.js';

/** `readOnlyHint: 1`, `idempotentHint: 1`, the other two empty — the three skill tools. */
const READ_ONLY_IDEMPOTENT: WriteToolRecord['hints'] = {
  readOnlyHint: true,
  destructiveHint: null,
  idempotentHint: true,
  openWorldHint: null,
};

const FILE_PARAM: WriteToolRecord['params'][number] = {
  name: 'file',
  type: 'string',
  required: false,
  description:
    'Package-relative POSIX path of a subfile to read, taken from the manifest (e.g. workflows/brief.md). Omit to open the skill itself. Defaults to "SKILL.md".',
};

export const SKILL_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  'skill-tools-load-skill-file': {
    server: 'skill-tools',
    name: 'load_skill_file',
    description:
      'Load an internal skill from the registry. This is the ONLY channel for reading a skill: skills are not on disk for you — never use Read on a skill path, and never open one with the native Skill() tool. Call it with `slug` alone to OPEN the skill: you get the SKILL.md content plus a manifest of every other file in the package (path, bytes, lines, isText), so you can decide what is worth reading before you pay for it. Call it again with `file` to read one of the manifest paths (e.g. workflows/brief.md) — that is how a skill routes you to its own subfiles. For an editable skill the content is the raw file, and `hash` is the value a write expects. A project skill whose SKILL.md header is not valid yet still opens: the response carries `invalid: true` and `invalidReason`. Available skills, with their descriptions, are listed in <available_skills/>; the active writing style is named in <project_writing_skill>. `file` is POSIX-relative to the package root: no absolute path, no `..`.',
    params: [
      {
        name: 'slug',
        type: 'string',
        required: true,
        description: 'Skill slug from the registry — the value shown in <available_skills/> or <project_writing_skill>.',
      },
      FILE_PARAM,
    ],
    hints: READ_ONLY_IDEMPOTENT,
  },
  'c4s-reader-load-skill-file': {
    server: 'c4s-reader',
    name: 'load_skill_file',
    description:
      "Load a writing-style or contextual skill from this project's internal registry — which also holds read-only skills of workspace projects exposed to this one — the conventions and methodology that govern how content in this specification may be written. Call it with `slug` alone to OPEN the skill: you get the SKILL.md content plus a manifest of every other file in the package (path, bytes, lines, isText), so you can decide what is worth reading before you pay for it. Call it again with `file` to read one of the manifest paths (e.g. workflows/brief.md) — that is how a skill routes you to its own subfiles. You do not read these skills from disk: the registry serves them through this tool and no response carries a disk path, so there is no path to read and no directory to list. A project skill whose SKILL.md header is not valid yet still opens: the response carries `invalid: true` and `invalidReason`. Discover the available slugs with `list_skills`, which also names the project's active writing style. `file` is POSIX-relative to the package root: no absolute path, no `..`.",
    params: [
      {
        name: 'slug',
        type: 'string',
        required: true,
        description: 'Skill slug from the registry — the value returned by `list_skills`.',
      },
      FILE_PARAM,
    ],
    hints: READ_ONLY_IDEMPOTENT,
  },
  'c4s-reader-list-skills': {
    server: 'c4s-reader',
    name: 'list_skills',
    description:
      'List the skills available for a context type in this project, together with the active writing style. Call this before `load_skill_file` — it is how you learn which slugs exist. The active writing style is BINDING on any content you write into this specification: open it with `load_skill_file` and follow it rather than your own conventions. Pass `contextType` to ask what a given kind of turn would see — a briefing or planning methodology typically lives in a subfile of the active style, so ask for the context you are about to work in. Omit it to get the whole registry. Reading a skill is not gated by context type: anything listed for any context can be opened.',
    params: [
      {
        name: 'contextType',
        type: 'string',
        required: false,
        description:
          "Context type whose skill set to list — one of `chat`, `brief`, `patch`, `ask`. Omit to list the whole registry instead of one context's set.",
      },
    ],
    hints: READ_ONLY_IDEMPOTENT,
  },
  'workspace-tools-list-projects': {
    server: 'workspace-tools',
    name: 'list_projects',
    description:
      'List the projects of this workspace: { workspace, projects: [{ id, name?, description? }] }.\n`id` is the only address of a project — pass it as the `project` argument of `ask`. `name` is a label, never a selector.\nA project whose config.json cannot be read is still listed, without `name` — it stays addressable by `id`. No directories are returned.\nRead-only. No pagination.',
    params: [],
  },
};
