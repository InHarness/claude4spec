import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ExposedProjectRow } from '../../../shared/spec-skills.js';
import type { ProjectTypeCard } from '../../../shared/project-types.js';
import type { WritingStylesResponse } from '../../../shared/writing-styles.js';
import { ApiError } from '../../lib/api-core.js';
import { EXPOSED_PROJECTS_QUERY_KEY, specSkillsApi } from '../../lib/spec-skills-api.js';
import { useWritingStyles } from '../../hooks/useWritingStyles.js';
import { useProjectTypes } from '../../hooks/useProjectTypes.js';
import { useConfig } from '../../hooks/useConfig.js';
import { groupByType } from '../../lib/group-by-type.js';
import { ElementField } from '../settings/controls.js';
import { EFFECT, type ElementContext, type SettingsContribution, type SettingsElementDecl } from '../settings/registry.js';

/**
 * 2.1.9 — what the spec-skills module (M52 L17 `1osy2o5r`) declares on
 * `/settings`: the `#skills` card in the Agent group — the exposure fields of a
 * project exposed as a skill of its workspace and the skill projects it uses —
 * and the element "Fork writing style locally" (weight 80, M52 `oqhvnhyf`), an
 * action outside the card's shared save.
 *
 * 2.1.77 (M52 `0ay8qh6u`, `ybbal0vf`, `1osy2o5r`): a project is a provider by
 * its type's capability `skill-exposure`, exposed from founding — there is no
 * exposure toggle and no scope choice any more (the scope follows from the
 * provider's type). The four exposure elements require `skill-exposure`: a
 * project whose type lacks it does not show them (`assembleSettings` drops
 * them); "Used skill projects" and the fork element stay in every type.
 */

const USES = ['skill', 'uses'] as const;

/** The capability the exposure elements require (M52 `0ay8qh6u`). */
export const SKILL_EXPOSURE = 'skill-exposure';

/** Effect message of the exposure fields: they act in the CONSUMERS. */
const FOR_CONSUMERS = 'Applies from the next new conversation in projects that use it.';

/**
 * 2.1.88 (M52 `1osy2o5r`): the options of `Context types` are the values of the
 * project's context-type registry, as `GET /api/config` derives them — not a
 * closed list. With the key absent every option is ticked (`allWhenAbsent`),
 * which is the key's default: all values of the registry.
 */
export function useContextTypeOptions(): Array<{ value: string; label: string }> | undefined {
  return useConfig().data?.contextTypes?.map((t) => ({ value: t, label: t }));
}

/** The marker a row of "Used skill projects" carries — never blocking a save. */
export function attachmentMarker(row: Pick<ExposedProjectRow, 'status'>): 'Unavailable' | 'Ambiguous' | null {
  if (row.status === 'unavailable') return 'Unavailable';
  if (row.status === 'ambiguous') return 'Ambiguous';
  return null;
}

/**
 * 2.1.67 (M52 `qtq9iusb`): the marker of an attachment of `skill.uses` whose
 * name is not confirmed on this machine — beside the status marker, never
 * blocking a save. A row the project does not attach has none.
 */
export function confirmationMarker(row: Pick<ExposedProjectRow, 'uses' | 'confirmed'>): 'Unconfirmed' | null {
  return row.uses && !row.confirmed ? 'Unconfirmed' : null;
}

/**
 * The confirmation list to write when `names` get confirmed: every name already
 * confirmed according to the list — outside `skill.uses` too — plus `names`,
 * order kept, a name once (M52 `qtq9iusb`, 2.1.69). `PUT /uses-confirmation`
 * replaces the stored list whole, so the confirmed ones are carried over and
 * unticking a row takes the attachment off, never its confirmation.
 *
 * ASSUMPTION:dev-6910 — the project's own exposed name has no row (M52
 * `qtq9iusb`: "bieżący projekt nie ma wiersza na liście"), so a stored
 * confirmation of that name is not "confirmed according to the list" and a card
 * write drops it. Kept deliberately: carrying it would need a row for the
 * current project or a server-side merge, and `PUT /uses-confirmation` replaces
 * the list whole (M31 `naxqsfra`). The own name resolves as `self` before any
 * confirmation check, so dropping it changes no attachment's status.
 */
export function confirmationAfter(rows: readonly ExposedProjectRow[], names: readonly string[]): string[] {
  const kept = rows.filter((r) => r.confirmed).map((r) => r.name);
  return [...new Set([...kept, ...names])];
}

/**
 * The names the draft adds to `skill.uses` — ticked now, not attached in the
 * saved config (the rows' `uses`). Adding a row on the card confirms its name
 * together with the save (M52 `qtq9iusb` "Dodanie potwierdza").
 */
export function addedUses(rows: readonly ExposedProjectRow[], draftUses: readonly string[]): string[] {
  const saved = new Set(rows.filter((r) => r.uses).map((r) => r.name));
  return draftUses.filter((n) => !saved.has(n));
}

/**
 * The names the draft of the card adds, kept for the element's `afterSave` (which
 * gets no draft). Per query client, so two apps in one page never share it.
 */
const pendingAdded = new WeakMap<QueryClient, string[]>();

/**
 * `afterSave` of "Used skill projects": the save wrote `skill.uses`; the names it
 * added are confirmed right after, by `PUT /api/spec-skills/uses-confirmation`,
 * then the list is re-read. Nothing added → no confirmation write.
 */
export async function confirmAddedAfterSave(
  queryClient: QueryClient,
  confirm: (names: string[]) => Promise<unknown> = (names) => specSkillsApi.confirmSkillUses(names),
): Promise<void> {
  const added = pendingAdded.get(queryClient) ?? [];
  pendingAdded.delete(queryClient);
  try {
    if (added.length > 0) {
      const rows = queryClient.getQueryData<ExposedProjectRow[]>(EXPOSED_PROJECTS_QUERY_KEY) ?? [];
      await confirm(confirmationAfter(rows, added));
    }
  } finally {
    await queryClient.invalidateQueries({ queryKey: EXPOSED_PROJECTS_QUERY_KEY });
  }
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
 *
 * 2.1.86 (M52): the rows are grouped by the provider's project type
 * ({@link groupByType} on `row.projectType`) — the order and the headers from
 * `types` (`GET /api/workspace/project-types`), no empty group; the rows with
 * no type (dangling or ambiguous) come last, after every group, with no header.
 * Without `types` the list is flat.
 */
export function UsedSkillProjectsList({
  rows,
  types,
  uses,
  disabled,
  onToggle,
  onConfirm,
  confirming,
}: {
  rows: readonly ExposedProjectRow[];
  /** The type registry list, in its order; absent → no grouping. */
  types?: readonly ProjectTypeCard[];
  uses: readonly string[];
  disabled?: boolean;
  onToggle: (name: string, on: boolean) => void;
  /** The confirmation action of an `Unconfirmed` row. */
  onConfirm?: (name: string) => void;
  /**
   * The name whose confirmation is being written. While one is in flight every
   * Confirm is disabled: `PUT /uses-confirmation` replaces the list whole, so a
   * second write built from the same (stale) rows would drop the first name.
   */
  confirming?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <span className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
        No project of this workspace is exposed as a skill.
      </span>
    );
  }
  const renderRow = (row: ExposedProjectRow) => {
    const marker = attachmentMarker(row);
    const unconfirmed = confirmationMarker(row);
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
            {unconfirmed ? (
              <span
                className="rounded px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide"
                style={{ border: '1px solid var(--c-hair)', color: '#a86a1a' }}
                data-marker={unconfirmed}
              >
                {unconfirmed}
              </span>
            ) : null}
          </span>
          {row.description ? (
            <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--c-subtle)' }}>
              {row.description}
            </span>
          ) : null}
        </span>
        {unconfirmed && onConfirm ? (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[11.5px] font-medium"
            style={{ border: '1px solid var(--c-hair)', color: 'var(--c-ink)', background: 'var(--c-bg)' }}
            disabled={disabled || (confirming ?? null) !== null}
            data-confirm-skill-use={row.name}
            onClick={(e) => {
              // Inside the row's <label>: the click confirms, it never (un)ticks the row.
              e.preventDefault();
              onConfirm(row.name);
            }}
          >
            Confirm
          </button>
        ) : null}
      </label>
    );
  };
  if (!types) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="used-skill-projects">
        {rows.map(renderRow)}
      </div>
    );
  }
  // A row of a type the registry does not know cannot be `ok` (such a provider
  // never activates); should one come, it stays with the untyped rows.
  const g = groupByType(rows, (r) => r.projectType, types);
  const tail = [...g.unknown.flatMap((u) => u.items), ...g.untyped];
  return (
    <div className="flex flex-col gap-1.5" data-testid="used-skill-projects">
      {g.known.map((group) => (
        <div key={group.slug} className="flex flex-col gap-1.5" data-project-type-group={group.slug}>
          <div
            data-testid="project-type-group-header"
            className="pt-1 text-[10.5px] font-medium uppercase tracking-wide"
            style={{ color: 'var(--c-subtle)' }}
          >
            {group.name}
          </div>
          {group.items.map(renderRow)}
        </div>
      ))}
      {tail.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-untyped-rows="">
          {tail.map(renderRow)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The custom element "Used skill projects": the list, wired to the card's draft.
 * 2.1.67 (M52 `qtq9iusb`): an `Unconfirmed` row has a "Confirm" action — a
 * machine-local write outside the card's shared save — and a row ticked here is
 * confirmed together with the save (`afterSave` → {@link confirmAddedAfterSave}).
 */
function UsedSkillProjectsElement({ draft, decl }: ElementContext & { decl: SettingsElementDecl }) {
  const queryClient = useQueryClient();
  const { data: rows } = useQuery({ queryKey: EXPOSED_PROJECTS_QUERY_KEY, queryFn: () => specSkillsApi.exposedProjects() });
  // 2.1.86: the type list orders and names the groups; unreadable → a flat list.
  const { data: types, isError: typesFailed } = useProjectTypes();
  const raw = draft.get(USES);
  const uses = Array.isArray(raw) ? (raw as string[]) : [];
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const added = rows ? addedUses(rows, uses) : [];
  const addedKey = added.join('\n');
  useEffect(() => {
    pendingAdded.set(queryClient, addedKey === '' ? [] : addedKey.split('\n'));
  }, [queryClient, addedKey]);
  // One confirmation at a time (the write replaces the list whole): a click while
  // one is in flight is dropped, even before the disabled buttons re-render.
  const inFlight = useRef(false);
  const onConfirm = (name: string) => {
    if (!rows || inFlight.current) return;
    inFlight.current = true;
    setConfirming(name);
    setConfirmError(null);
    specSkillsApi.confirmSkillUses(confirmationAfter(rows, [name])).then(
      async () => {
        try {
          await queryClient.invalidateQueries({ queryKey: EXPOSED_PROJECTS_QUERY_KEY });
        } finally {
          inFlight.current = false;
          setConfirming(null);
        }
      },
      (err: unknown) => {
        setConfirmError(err instanceof Error ? err.message : String(err));
        inFlight.current = false;
        setConfirming(null);
      },
    );
  };
  return (
    <ElementField label={decl.label} help={decl.help} error={draft.error(USES) ?? confirmError} asLabel={false}>
      {rows === undefined || (types === undefined && !typesFailed) ? (
        <span className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Loading…
        </span>
      ) : (
        <UsedSkillProjectsList
          rows={rows}
          types={types}
          uses={uses}
          disabled={draft.saving}
          onToggle={(name, on) => draft.set(USES, toggleUse(uses, name, on))}
          onConfirm={onConfirm}
          confirming={confirming}
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
      group: 'Agent',
      weight: 20,
      owner: 'spec-skills',
      scope: 'project',
    },
  ],
  elements: [
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
      requires: [SKILL_EXPOSURE],
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
      requires: [SKILL_EXPOSURE],
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
      help: 'Projects that use this one read it live and read-only.',
      effectMessage: 'Applies to the next read.',
      requires: [SKILL_EXPOSURE],
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
      useOptions: useContextTypeOptions,
      effectMessage: FOR_CONSUMERS,
      requires: [SKILL_EXPOSURE],
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
      // 2.1.67 (M52 `qtq9iusb`): a row added here is confirmed with the save.
      afterSave: ({ queryClient }) => confirmAddedAfterSave(queryClient),
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
