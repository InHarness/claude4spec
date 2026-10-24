import { create } from 'zustand';

/**
 * 2.1.10 (M28 8i5qf0xx, M31 ic35jwy6) — the git operations THIS client has in
 * flight. The WS map needs them to tell "my own sync/checkout moved HEAD" (the
 * response handler reloads the project route) from "another client moved HEAD"
 * (`git:status-changed { headChanged: true }` → reload here).
 *
 * 2.1.47 (M17 L5 m17ui001) — `'accept'`: the shadow acceptance from
 * `/releases`. Its release commit moves HEAD, yet the screen stays: the
 * success toast and the List tab, no route reload. The server broadcasts the
 * event before it answers, but the WS frame and the HTTP answer travel on two
 * channels, so either may arrive first: an acceptance whose answer says HEAD
 * moved stays registered until its event has been attributed to it.
 */
export type GitOwnOp = 'accept' | 'checkout' | 'fetch' | 'sync';

/** The own operations whose success moves HEAD (`fetch` only moves remote refs). */
const MOVES_HEAD: ReadonlySet<GitOwnOp> = new Set<GitOwnOp>(['accept', 'checkout', 'sync']);

export interface GitOwnOpEntry {
  op: GitOwnOp;
  /** A `headChanged: true` event has already been attributed to this operation. */
  headSeen: boolean;
  /** Its answer arrived and said HEAD moved; the entry only waits for that event. */
  answered: boolean;
}

interface GitOpsState {
  /** Own operations in flight, in the order they began. Several may overlap. */
  ops: GitOwnOpEntry[];
  begin(op: GitOwnOp): void;
  /** Drops the oldest unanswered entry of `op` (its answer says HEAD did not move, or it failed). */
  end(op: GitOwnOp): void;
  /**
   * The answer of `op` says HEAD moved and the screen stays (no reload): drop
   * the entry when its HEAD event was already attributed to it, otherwise keep
   * it until that event arrives.
   */
  answeredWithHeadChange(op: GitOwnOp): void;
  /**
   * Attributes one `headChanged: true` event to the oldest own HEAD-moving
   * operation that has not had one yet; `null` = another client moved HEAD.
   * An answered entry is consumed by it.
   */
  claimHeadChange(): GitOwnOp | null;
  /**
   * The live-update socket reconnected: a `git:status-changed` frame broadcast
   * while it was down is not replayed, so an answered entry still waiting for
   * its HEAD event will never get it — drop every answered entry, lest it
   * absorb the next HEAD move of another client.
   */
  dropAnswered(): void;
}

const without = (ops: readonly GitOwnOpEntry[], i: number) => [...ops.slice(0, i), ...ops.slice(i + 1)];

export const useGitOpsStore = create<GitOpsState>((set, get) => ({
  ops: [],
  begin: (op) => set({ ops: [...get().ops, { op, headSeen: false, answered: false }] }),
  end: (op) => {
    const ops = get().ops;
    const i = ops.findIndex((e) => e.op === op && !e.answered);
    if (i >= 0) set({ ops: without(ops, i) });
  },
  answeredWithHeadChange: (op) => {
    const ops = get().ops;
    const i = ops.findIndex((e) => e.op === op && !e.answered);
    if (i < 0) return;
    if (ops[i]!.headSeen) set({ ops: without(ops, i) });
    else set({ ops: ops.map((e, j) => (j === i ? { ...e, answered: true } : e)) });
  },
  claimHeadChange: () => {
    const ops = get().ops;
    const i = ops.findIndex((e) => MOVES_HEAD.has(e.op) && !e.headSeen);
    if (i < 0) return null;
    const entry = ops[i]!;
    if (entry.answered) set({ ops: without(ops, i) });
    else set({ ops: ops.map((e, j) => (j === i ? { ...e, headSeen: true } : e)) });
    return entry.op;
  },
  dropAnswered: () => {
    const ops = get().ops;
    if (ops.some((e) => e.answered)) set({ ops: ops.filter((e) => !e.answered) });
  },
}));
