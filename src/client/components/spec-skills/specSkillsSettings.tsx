import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExposedProjectRow } from '../../../shared/spec-skills.js';
import type { WritingStylesResponse } from '../../../shared/writing-styles.js';
import { ApiError } from '../../lib/api-core.js';
import { EXPOSED_PROJECTS_QUERY_KEY, specSkillsApi } from '../../lib/spec-skills-api.js';
import { useWritingStyles } from '../../hooks/useWritingStyles.js';
import { ElementField } from '../settings/controls.js';
import { EFFECT, type ElementContext, type SettingsContribution, type SettingsElementDecl } from '../settings/registry.js';

/**
 * 2.1.9 — what the spec-skills module (M52 L17 `1osy2o5r`) declares on
 * `/settings`: the `#skills` card in the Agent group — the project exposed as a
 * skill of its workspace (toggle + exposure fields) and the skill projects it
 * uses — and the element "Fork writing style locally" (weight 80, M52
 * `oqhvnhyf`), an action outside the card's shared save.
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

/** Inline messages of "Fork writing style locally" (M52 `oqhvnhyf`). */
export const FORK_DONE_MESSAGE = "Copied to the project's skills. The local copy now takes precedence over the plugin.";
export const FORK_CONFLICT_MESSAGE = 'A skill with this name already exists in this project.';

/**
 * Visibility of "Fork writing style locally": the slug of the active writing
 * style when its winning entry comes from a plugin (so it is not shadowed by a
 * package of another source), otherwise `null` — the element is hidden.
 */
export function forkableWritingStyle(styles: WritingStylesResponse | undefined): string | null {
  if (!styles?.active) return null;
  const active = styles.available.find((s) => s.slug === styles.active);
  return active?.source === 'plugin' ? active.slug : null;
}

/** Ready → in progress → done, or a refusal (the conflict has its own message). */
export type ForkState = { kind: 'ready' } | { kind: 'pending' } | { kind: 'done' } | { kind: 'failed'; message: string };

/** The refusal of a fork, in the words the card shows inline. */
export function forkFailureMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'SKILL_ALREADY_EXISTS') return FORK_CONFLICT_MESSAGE;
  return err instanceof Error ? err.message : String(err);
}

/**
 * The element, presentational: one button, blocked while the fork runs, and the
 * inline result under it. No dialog, no toast.
 */
export function ForkWritingStyleControl({ state, onFork }: { state: ForkState; onFork: () => void }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="fork-writing-style">
      <div>
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-[12.5px] font-medium"
          style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)', background: 'var(--c-bg)' }}
          disabled={state.kind === 'pending'}
          onClick={onFork}
        >
          Fork writing style locally
        </button>
      </div>
      {state.kind === 'done' ? (
        <span className="text-[12px]" style={{ color: 'var(--c-muted)' }} data-fork-result="done">
          {FORK_DONE_MESSAGE}
        </span>
      ) : null}
      {state.kind === 'failed' ? (
        <span className="text-[12px]" style={{ color: '#a8321a' }} data-fork-result="failed">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

/**
 * "Fork writing style locally" (weight 80): calls `POST /api/spec-skills/style-forks`
 * with the active style's slug. Shown only while the active style comes from a
 * plugin — a condition on a query, so it lives here rather than in `visible` —
 * and kept after a fork so its result stays readable. `config.writingStyle` is
 * not touched; the writing-styles list is refetched (the active style now comes
 * from the project's skills root), and the new package's accordion arrives with
 * the sidebar's own `sidebar:accordions-changed`.
 */
function ForkWritingStyleElement(_props: ElementContext & { decl: SettingsElementDecl }) {
  const { data: styles } = useWritingStyles();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ForkState>({ kind: 'ready' });
  const [slug, setSlug] = useState<string | null>(null);
  const forkable = forkableWritingStyle(styles);
  const target = slug ?? forkable;
  if (target === null || (forkable === null && state.kind === 'ready')) return null;
  const onFork = () => {
    setSlug(target);
    setState({ kind: 'pending' });
    specSkillsApi.forkWritingStyle(target).then(
      () => {
        setState({ kind: 'done' });
        void queryClient.invalidateQueries({ queryKey: ['writing-styles'] });
      },
      (err: unknown) => setState({ kind: 'failed', message: forkFailureMessage(err) }),
    );
  };
  return (
    // The button carries the element's name; the field adds no second label.
    <ElementField asLabel={false}>
      <ForkWritingStyleControl state={state} onFork={onFork} />
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
    {
      id: 'fork-writing-style',
      card: 'skills',
      weight: 80,
      kind: 'custom',
      owner: 'spec-skills',
      label: 'Fork writing style locally',
      component: ForkWritingStyleElement,
    },
  ],
};
