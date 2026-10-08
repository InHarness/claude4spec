import { useQuery } from '@tanstack/react-query';
import type { ExposedProjectRow } from '../../../shared/spec-skills.js';
import { EXPOSED_PROJECTS_QUERY_KEY, specSkillsApi } from '../../lib/spec-skills-api.js';
import { ElementField } from '../settings/controls.js';
import { EFFECT, type ElementContext, type SettingsContribution, type SettingsElementDecl } from '../settings/registry.js';

/**
 * 2.1.9 — what the spec-skills module (M52 L17 `1osy2o5r`) declares on
 * `/settings`: the `#skills` card in the Agent group — the project exposed as a
 * skill of its workspace (toggle + exposure fields) and the skill projects it
 * uses. The element "Fork writing style locally" (weight 80) belongs to the
 * writing-style fork and is not declared here.
 */

const EXPOSED = ['skill', 'exposed'] as const;
const USES = ['skill', 'uses'] as const;

/** Effect message of the exposure fields: they act in the CONSUMERS. */
const FOR_CONSUMERS = 'Applies from the next new conversation in projects that use it.';

/** Every exposure field but the toggle is shown only while `skill.exposed` is on (in the draft). */
const whenExposed = ({ draft }: ElementContext): boolean => draft.get(EXPOSED) === true;

const CONTEXT_TYPES = ['chat', 'brief', 'patch', 'ask'] as const;

/** The marker a row of "Used skill projects" carries — never blocking a save. */
export function attachmentMarker(row: Pick<ExposedProjectRow, 'status'>): 'Unavailable' | 'Ambiguous' | null {
  if (row.status === 'unavailable') return 'Unavailable';
  if (row.status === 'ambiguous') return 'Ambiguous';
  return null;
}

/** `skill.uses` after (un)ticking `name` — order kept, a name once. */
export function toggleUse(uses: readonly string[], name: string, on: boolean): string[] {
  const without = uses.filter((u) => u !== name);
  return on ? [...without, name] : without;
}

/**
 * The list itself, presentational: one row per name from
 * `GET /api/spec-skills/exposed-projects`, ticked when the DRAFT's `skill.uses`
 * holds it. The current project never has a row (the route leaves it out).
 */
export function UsedSkillProjectsList({
  rows,
  uses,
  disabled,
  onToggle,
}: {
  rows: readonly ExposedProjectRow[];
  uses: readonly string[];
  disabled?: boolean;
  onToggle: (name: string, on: boolean) => void;
}) {
  if (rows.length === 0) {
    return (
      <span className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
        No project of this workspace is exposed as a skill.
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="used-skill-projects">
      {rows.map((row) => {
        const marker = attachmentMarker(row);
        return (
          <label
            key={row.name}
            className="flex items-start gap-3 rounded-md px-3 py-2"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
            data-skill-name={row.name}
          >
            <input
              type="checkbox"
              checked={uses.includes(row.name)}
              disabled={disabled}
              onChange={(e) => onToggle(row.name, e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="flex-1">
              <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
                {row.name}
                {marker ? (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide"
                    style={{ border: '1px solid var(--c-hair)', color: '#a86a1a' }}
                    data-marker={marker}
                  >
                    {marker}
                  </span>
                ) : null}
              </span>
              {row.description ? (
                <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
                  {row.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** The custom element "Used skill projects": the list, wired to the card's draft. */
function UsedSkillProjectsElement({ draft, decl }: ElementContext & { decl: SettingsElementDecl }) {
  const { data: rows } = useQuery({ queryKey: EXPOSED_PROJECTS_QUERY_KEY, queryFn: () => specSkillsApi.exposedProjects() });
  const raw = draft.get(USES);
  const uses = Array.isArray(raw) ? (raw as string[]) : [];
  return (
    <ElementField label={decl.label} help={decl.help} error={draft.error(USES)} asLabel={false}>
      {rows === undefined ? (
        <span className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Loading…
        </span>
      ) : (
        <UsedSkillProjectsList
          rows={rows}
          uses={uses}
          disabled={draft.saving}
          onToggle={(name, on) => draft.set(USES, toggleUse(uses, name, on))}
        />
      )}
    </ElementField>
  );
}

export const SPEC_SKILLS_SETTINGS: SettingsContribution = {
  cards: [
    {
      anchor: 'skills',
      title: 'Skills',
      description: 'Projects that use this one read it live and read-only.',
      group: 'Agent',
      weight: 20,
      owner: 'spec-skills',
    },
  ],
  elements: [
    {
      id: 'skill-exposed',
      card: 'skills',
      weight: 10,
      kind: 'toggle',
      owner: 'spec-skills',
      configKey: [...EXPOSED],
      baseline: (config) => config.skill?.exposed ?? false,
      label: 'Expose this project as a skill',
      effectMessage: FOR_CONSUMERS,
    },
    {
      id: 'skill-name',
      card: 'skills',
      weight: 20,
      kind: 'text',
      owner: 'spec-skills',
      configKey: ['skill', 'name'],
      label: 'Skill name',
      tooltip: 'The address other projects in this workspace use to attach this project as a skill.',
      emptyAsNull: true,
      effectMessage: FOR_CONSUMERS,
      visible: whenExposed,
    },
    {
      id: 'skill-description',
      card: 'skills',
      weight: 30,
      kind: 'textarea',
      owner: 'spec-skills',
      configKey: ['skill', 'description'],
      label: 'Skill description',
      emptyAsNull: true,
      effectMessage: FOR_CONSUMERS,
      visible: whenExposed,
    },
    {
      id: 'skill-entry',
      card: 'skills',
      weight: 40,
      kind: 'text',
      owner: 'spec-skills',
      configKey: ['skill', 'entry'],
      label: 'Entry page',
      placeholder: 'index.md',
      emptyAsNull: true,
      effectMessage: 'Applies to the next read.',
      visible: whenExposed,
    },
    {
      id: 'skill-scope',
      card: 'skills',
      weight: 50,
      kind: 'select',
      owner: 'spec-skills',
      configKey: ['skill', 'scope'],
      baseline: (config) => config.skill?.scope ?? 'contextual',
      label: 'Scope',
      useOptions: () => [
        { value: 'writing-style', label: 'writing-style' },
        { value: 'contextual', label: 'contextual' },
      ],
      effectMessage: FOR_CONSUMERS,
      visible: whenExposed,
    },
    {
      id: 'skill-context-types',
      card: 'skills',
      weight: 60,
      kind: 'multiselect',
      owner: 'spec-skills',
      configKey: ['skill', 'contextTypes'],
      allWhenAbsent: true,
      label: 'Context types',
      useOptions: () => CONTEXT_TYPES.map((t) => ({ value: t, label: t })),
      effectMessage: FOR_CONSUMERS,
      visible: whenExposed,
    },
    {
      id: 'used-skill-projects',
      card: 'skills',
      weight: 70,
      kind: 'custom',
      owner: 'spec-skills',
      keys: [[...USES]],
      label: 'Used skill projects',
      effectMessage: EFFECT.newThread,
      component: UsedSkillProjectsElement,
      afterSave: ({ queryClient }) => queryClient.invalidateQueries({ queryKey: EXPOSED_PROJECTS_QUERY_KEY }),
    },
  ],
};
