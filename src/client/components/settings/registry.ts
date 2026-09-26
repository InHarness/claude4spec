import type { ComponentType, ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import type { ConfigResponse } from '../../lib/api.js';

/**
 * 0.2.113 — the settings module as INFRASTRUCTURE: the card registry.
 *
 * Until 0.2.112 `/settings` was a hand-written stack of fourteen section
 * components, all living in this module. Now the page is ASSEMBLED from what the
 * owning modules declare: a card (anchor, group, weight) and the elements that
 * sit in it (kind, weight, the config key it edits). The settings module keeps
 * only the registry, the generated controls, the per-card save, and two cards of
 * its own (About, Index status).
 *
 * Ordering: group (closed list) → card weight → element weight. Groups render no
 * headings. An element pointing at a card that does not exist — or is not
 * visible — simply does not render; that is not an error. Two cards with one
 * anchor IS: every anchor is a `#<kebab>` target and must be unique on the page.
 */
export const SETTINGS_GROUPS = ['Account', 'Project', 'Integrations', 'Plugins', 'Agent', 'System'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/**
 * Generated kinds render from the declaration alone; `custom` is the declaring
 * module's own component.
 *
 *  - `lines`: one array value per line — split on newlines, trimmed, empty dropped.
 *  - `path`: a cwd-relative directory — text plus a `directory-browse` picker.
 */
export type ElementKind = 'toggle' | 'text' | 'textarea' | 'lines' | 'select' | 'multiselect' | 'path' | 'custom';

/** A config key as path segments (a plugin's package name may itself contain dots). */
export type ConfigKeyPath = readonly string[];

export interface SelectOption {
  value: string;
  label: string;
}

/** What the per-card draft offers an element — generated or custom. */
export interface CardDraft {
  /** The draft value of a key: the unsaved edit, else what config holds. */
  get(key: ConfigKeyPath): unknown;
  set(key: ConfigKeyPath, value: unknown): void;
  /** The server's refusal, or a live validation error, pinned to this key. */
  error(key: ConfigKeyPath): string | null;
  /** A custom element reports its own live check here; an error blocks [Save]. */
  setLiveError(key: ConfigKeyPath, message: string | null): void;
  isDirty(key: ConfigKeyPath): boolean;
  /** True while this card's PATCH is in flight. */
  saving: boolean;
  /** Set by a custom element to hold the card's [Save] (e.g. a rename in flight). */
  setBusy(reason: string | null): void;
}

export interface ElementContext {
  config: ConfigResponse;
  draft: CardDraft;
}

export interface SettingsElementDecl {
  /** Unique within its card. */
  id: string;
  /** The anchor of the card this element sits in. */
  card: string;
  weight: number;
  kind: ElementKind;
  /** Documentary — the module that answers for the element. */
  owner: string;
  /**
   * The config key a generated element edits. A `custom` element that writes
   * file keys lists them in `keys` instead — either one makes the card a
   * file-backed card with a [Save].
   */
  configKey?: ConfigKeyPath;
  keys?: readonly ConfigKeyPath[];
  label?: string;
  help?: ReactNode;
  /**
   * When a saved change starts to act, in the user's words — shown in the toast
   * after [Save]. Never names an effect class. Absent ⇒ the element adds nothing
   * to the toast.
   */
  effectMessage?: string;
  /** Options of a `select` / `multiselect` — a hook, since most come from a query. */
  useOptions?: () => SelectOption[] | undefined;
  /** `select`: the label of the choice that saves `null` (e.g. "None"). */
  nullOption?: string;
  placeholder?: string;
  /** `text` / `textarea`: shows a `<n>/<max>` counter. */
  maxLength?: number;
  /**
   * The browser-only half of validation (the spec's `UI:` rules). An `error`
   * blocks [Save] before anything is sent; a `warning` never does.
   */
  validate?: (value: unknown, ctx: ElementContext) => { error?: string; warning?: string } | null;
  /** `text` / `textarea`: an empty value saves as `null` (a nullable field). */
  emptyAsNull?: boolean;
  /**
   * The value the control shows when the file says nothing — `entities` absent
   * means "every type active", which a multiselect must render as all ticked.
   * Also the baseline an edit is compared against.
   */
  baseline?: (config: ConfigResponse) => unknown;
  /** `multiselect`: a key absent from the file means every option is selected. */
  allWhenAbsent?: boolean;
  /** Runs after a successful [Save] that changed this element's key. */
  afterSave?: (env: AfterSaveEnv) => Promise<void> | void;
  visible?: (ctx: ElementContext) => boolean;
  component?: ComponentType<ElementContext & { decl: SettingsElementDecl }>;
}

export interface AfterSaveEnv {
  router: AnyRouter;
  queryClient: QueryClient;
}

export interface SettingsCardDecl {
  /** `#<kebab>` target, unique on the page. */
  anchor: string;
  title: string;
  description?: string;
  group: SettingsGroup;
  weight: number;
  owner: string;
  tone?: 'danger';
  visible?: (config: ConfigResponse) => boolean;
}

export interface SettingsContribution {
  cards?: SettingsCardDecl[];
  elements?: SettingsElementDecl[];
}

export class SettingsRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsRegistrationError';
  }
}

export interface AssembledCard {
  decl: SettingsCardDecl;
  elements: SettingsElementDecl[];
}

const ANCHOR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The page, assembled: every card in group → weight order, each with its elements
 * in weight order. Throws on a malformed or colliding anchor, and on two elements
 * of one card sharing an id.
 */
export function assembleSettings(contributions: SettingsContribution[]): AssembledCard[] {
  const cards = new Map<string, SettingsCardDecl>();
  for (const c of contributions.flatMap((x) => x.cards ?? [])) {
    if (!ANCHOR_RE.test(c.anchor)) {
      throw new SettingsRegistrationError(`settings card anchor "#${c.anchor}" (${c.owner}) is not kebab-case`);
    }
    const existing = cards.get(c.anchor);
    if (existing) {
      throw new SettingsRegistrationError(
        `settings card anchor "#${c.anchor}" is declared twice — by "${existing.owner}" and by "${c.owner}"`,
      );
    }
    cards.set(c.anchor, c);
  }
  const byCard = new Map<string, SettingsElementDecl[]>();
  for (const e of contributions.flatMap((x) => x.elements ?? [])) {
    const list = byCard.get(e.card) ?? [];
    if (list.some((o) => o.id === e.id)) {
      throw new SettingsRegistrationError(`settings element "${e.id}" is declared twice on card "#${e.card}"`);
    }
    list.push(e);
    byCard.set(e.card, list);
  }
  const groupIndex = (g: SettingsGroup) => SETTINGS_GROUPS.indexOf(g);
  return [...cards.values()]
    .sort(
      (a, b) =>
        groupIndex(a.group) - groupIndex(b.group) || a.weight - b.weight || a.title.localeCompare(b.title),
    )
    .map((decl) => ({
      decl,
      elements: [...(byCard.get(decl.anchor) ?? [])].sort((a, b) => a.weight - b.weight),
    }));
}

/** Every config key an element writes — `configKey` and `keys` together. */
export function elementKeys(e: SettingsElementDecl): ConfigKeyPath[] {
  return [...(e.configKey ? [e.configKey] : []), ...(e.keys ?? [])];
}

/** The dotted form the server pins a refusal to (`details.field`). */
export function keyId(key: ConfigKeyPath): string {
  return key.join('.');
}

export function readKey(obj: unknown, key: ConfigKeyPath): unknown {
  let cur: unknown = obj;
  for (const seg of key) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function writeKey(obj: Record<string, unknown>, key: ConfigKeyPath, value: unknown): void {
  let cur = obj;
  for (const seg of key.slice(0, -1)) {
    const next = cur[seg];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[key[key.length - 1]!] = value;
}

/** Structural equality for draft-vs-baseline — config values are plain JSON. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** `lines` kind: one array value per line — split, trimmed, empty dropped. */
export function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The toast after a successful [Save]: the effect message of every changed
 * element, each once. None of them names an effect class.
 */
export function effectMessagesFor(elements: SettingsElementDecl[], changedKeys: ConfigKeyPath[]): string[] {
  const changed = new Set(changedKeys.map(keyId));
  const out: string[] = [];
  for (const e of elements) {
    if (!e.effectMessage) continue;
    if (!elementKeys(e).some((k) => changed.has(keyId(k)))) continue;
    if (!out.includes(e.effectMessage)) out.push(e.effectMessage);
  }
  return out;
}

/** Effect messages shared by several declarants (spec §2, verbatim). */
export const EFFECT = {
  newThread: 'Applies from the next new conversation.',
  perTurn: 'Applies from the next agent turn, also in ongoing conversations.',
  perTurnResumed: 'Applies from the next agent turn, also in resumed conversations.',
  resumeBreak:
    'Applies from the next new conversation. Existing conversations can no longer be resumed — start a new one to continue.',
  rebuild: 'Applied — the project context will be rebuilt on the next request',
  rebuildResumeBreak:
    'Applied — the project context will be rebuilt on the next request. Existing conversations can no longer be resumed — start a new one to continue.',
  git: 'Applies from the next release, pull or push.',
  immediate: 'Applies immediately.',
} as const;
