/**
 * 2.1.9 (M20 `lxdrxdm2`) — what the slash popover lists: the context's FIXED
 * commands plus the items of the command sources the context admits.
 *
 * One `SlashSession` lives for one opening of the popover (the `/` suggestion
 * from its start to its exit):
 *
 *  - **Pull on open.** The first listing of a session asks every admitted
 *    source for its items, once; later keystrokes of the same opening filter
 *    that answer. Nothing outlives the session, so a change of project state is
 *    visible at the next opening without rebuilding the editor.
 *  - **Whitelist.** Only sources whose id stands in the context's
 *    `EditorContextSpec.slashCommands` are asked (`getSlashCommandSourcesForContext`).
 *  - **Filter.** The prefix typed after `/` is matched against an item's `hint`
 *    (its visible trigger).
 *  - **Collision.** An item whose `hint` equals the visible trigger of a fixed
 *    command mounted in the context is dropped; the fixed command stays. In the
 *    narrowed view there are no fixed commands, so nothing collides.
 *  - **Read failure.** A source whose listing throws or rejects contributes no
 *    items; the fixed commands and the other sources' items still show.
 *  - **Narrowing.** `narrowTo(sourceId)` switches the session to the items of
 *    that source alone.
 *
 * Pure (no DOM, no editor) so the rules are testable without a view; the
 * `SlashCommands` extension owns the popup and the session's lifetime.
 */
import type { SlashCommand } from './extensions/SlashMenu.js';
import {
  getRegisteredSlashCommandsForContext,
  getSlashCommandSourcesForContext,
  type EditorContextId,
  type RootEditorProps,
  type SlashCommandSource,
  type SlashCommandSourceItem,
} from './registry.js';

/** One row of the popover: a fixed command or a command-source item. */
export interface SlashPaletteItem {
  /** Unique within one listing. */
  key: string;
  label: string;
  description: string;
  hint: string;
  /** The origin marker, shown beside the label (source items only). */
  origin?: string;
  /** Set for a fixed command. */
  command?: SlashCommand;
  /** Set for a command-source item. */
  source?: { source: SlashCommandSource; item: SlashCommandSourceItem };
}

export interface SlashSession {
  /** The rows for `query` (the text typed after `/`). */
  items(query: string): Promise<SlashPaletteItem[]>;
  /** Narrow this opening to the items of one command source. */
  narrowTo(sourceId: string): void;
  /** The source this opening is narrowed to, or null for the full view. */
  readonly narrowedTo: string | null;
}

/**
 * The visible trigger of a fixed command. The command's `label` is what the
 * popover shows as its shortcut (`/section`); its `hint` field carries an
 * argument hint (`anchor`). ASSUMPTION:dev-0302 — a source item's `hint` is
 * compared with the fixed command's `label`.
 */
function fixedTrigger(command: SlashCommand): string {
  return normalizeTrigger(command.label);
}

/** `/Section ` → `section`: the trigger without its slash, case and padding. */
export function normalizeTrigger(value: string): string {
  return value.trim().replace(/^\//, '').toLowerCase();
}

function filterFixed(commands: SlashCommand[], q: string): SlashCommand[] {
  if (!q) return commands;
  return commands.filter((c) => c.id.includes(q) || c.label.toLowerCase().includes(q));
}

function sourceRow(source: SlashCommandSource, item: SlashCommandSourceItem): SlashPaletteItem {
  return {
    key: `source:${source.id}:${item.id}`,
    label: item.label,
    description: item.description,
    hint: item.hint,
    origin: item.origin,
    source: { source, item },
  };
}

async function readSource(source: SlashCommandSource): Promise<SlashCommandSourceItem[]> {
  try {
    const items = await source.list();
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.warn(`[editor] command source "${source.id}" failed to list its items`, err);
    return [];
  }
}

export function createSlashSession(contextId: EditorContextId, rootProps?: RootEditorProps): SlashSession {
  let pulled: Promise<Array<{ source: SlashCommandSource; items: SlashCommandSourceItem[] }>> | null = null;
  let narrowed: string | null = null;

  const pull = () => {
    if (!pulled) {
      const sources = getSlashCommandSourcesForContext(contextId, rootProps);
      pulled = Promise.all(sources.map(async (source) => ({ source, items: await readSource(source) })));
    }
    return pulled;
  };

  return {
    get narrowedTo() {
      return narrowed;
    },
    narrowTo(sourceId: string) {
      narrowed = sourceId;
    },
    async items(query: string): Promise<SlashPaletteItem[]> {
      const q = normalizeTrigger(query);
      const lists = await pull();
      const matches = (item: SlashCommandSourceItem) => !q || normalizeTrigger(item.hint).startsWith(q);

      if (narrowed) {
        const entry = lists.find((l) => l.source.id === narrowed);
        return entry ? entry.items.filter(matches).map((item) => sourceRow(entry.source, item)) : [];
      }

      const fixed = getRegisteredSlashCommandsForContext(contextId, rootProps);
      const taken = new Set(fixed.map(fixedTrigger));
      const rows: SlashPaletteItem[] = filterFixed(fixed, q).map((command) => ({
        key: `command:${command.id}`,
        label: command.label,
        description: command.description,
        hint: command.hint,
        command,
      }));
      for (const { source, items } of lists) {
        for (const item of items) {
          if (taken.has(normalizeTrigger(item.hint))) continue;
          if (!matches(item)) continue;
          rows.push(sourceRow(source, item));
        }
      }
      return rows;
    },
  };
}
