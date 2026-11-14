/**
 * M11 `6exnmup9` — the `ask` row, contributed by c4s. `Wejście: nowy wątek +
 * konsultacja`: it carries every consultation another project asks of this one.
 * Read-only towards the spec comes from two columns — the posture pinned to plan
 * mode and `Klasy operacji: read, plan` (a consultation may leave a plan, it does
 * not change the peer's spec nor order further turns). The row does not name
 * `c4s-tools`, so a consultation never chains onto another peer (start-up
 * invariant, M44 `8rnqx0vu`).
 */
import { INTERACTION_RULES } from '../../interaction-rules.js';
import { POOL, type ContextTypeRow } from '../row.js';

export const ASK_ROW: ContextTypeRow = {
  value: 'ask',
  owner: 'M11',
  moduleRequires: [],
  requiresCapabilities: [],
  entry: ['new-thread', 'consultation'],
  servers: [POOL, 'plan-tools'],
  uiChrome: 'overlay',
  posture: {
    kind: 'pinned',
    planMode: true,
    reason: 'reading without writing reuses the existing plan-mode posture, not a new mechanism',
  },
  builtinGroups: 'none',
  operationClasses: ['read', 'plan'],
  subagent: 'spec-explore',
  backgroundTasks: 'disabled',
  interactionRules: INTERACTION_RULES.ask,
  promptComposition: 'default',
  threadArtifact: null,
};
