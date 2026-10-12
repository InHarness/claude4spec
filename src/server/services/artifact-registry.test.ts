import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_KIND_OF_ROOT_KIND,
  ARTIFACT_READ_FAMILY,
  ARTIFACT_ROOT_KIND,
  artifactEntry,
  artifactHeaderContract,
  artifactRegistry,
  artifactRootId,
  bindingAddress,
  type ArtifactKind,
  type ArtifactRootKind,
} from './artifact-registry.js';
import { OWNER_THREAD_ISOLATION, artifactAddressingShape } from '../operations/addressing.js';
import { KIND_DECLARATIONS, SYSTEM_ROOT_KINDS, headerContractOf } from '../../shared/root-kinds.js';

/**
 * 2.1.8 — M36 `artifactRegistry` (m36reg01, m36bind01, m36csch1). The registry
 * is keyed by ROOT KIND and carries only what the root layer does not ask
 * about: the thread binding and the dangling policy. Directory, header
 * contract, flags and reactions live in the kind's declaration (L13).
 */

const ROOT_KINDS: ArtifactRootKind[] = ['briefs', 'patches', 'plans'];

/** The removed entry fields — none may come back on any entry. */
const REMOVED_FIELDS = [
  'kind',
  'dirConfigKey',
  'rootId',
  'frontmatterType',
  'frontmatterContract',
  'gitPolicy',
  'anchorInjection',
  'sectionIndexed',
];

describe('M36 artifactRegistry — keyed by root kind (2.1.8)', () => {
  it('[ac:ac-m36-trzyma-artifactregistry-jeden-wp] one entry per root kind (plans / briefs / patches), each carrying only `binding` (mode + contextType + chat_thread column) and `danglingPolicy`', () => {
    // One entry per root kind — and the keys ARE root kinds, not artifact kinds.
    expect(Object.keys(artifactRegistry).sort()).toEqual(['briefs', 'patches', 'plans']);
    for (const key of Object.keys(artifactRegistry)) {
      expect(SYSTEM_ROOT_KINDS as readonly string[]).toContain(key);
    }

    for (const rootKind of ROOT_KINDS) {
      const entry = artifactRegistry[rootKind] as unknown as Record<string, unknown>;
      // Only `binding` and `danglingPolicy`.
      expect(Object.keys(entry).sort(), rootKind).toEqual(['binding', 'danglingPolicy']);
      for (const removed of REMOVED_FIELDS) expect(entry, `${rootKind}.${removed}`).not.toHaveProperty(removed);
      // `binding` = mode + contextType (optional) + threadColumn, nothing else.
      const binding = entry.binding as Record<string, unknown>;
      for (const k of Object.keys(binding)) expect(['mode', 'contextType', 'threadColumn']).toContain(k);
    }

    // The binding matrix (m36bind01).
    expect(artifactRegistry.briefs).toEqual({
      binding: { mode: 'anchor', contextType: 'brief', threadColumn: 'brief_path' },
      danglingPolicy: 'invariant-banner',
    });
    expect(artifactRegistry.patches).toEqual({
      binding: { mode: 'anchor', contextType: 'patch', threadColumn: 'patch_path' },
      danglingPolicy: 'invariant-banner',
    });
    expect(artifactRegistry.plans).toEqual({
      binding: { mode: 'attach', threadColumn: 'plan_path' },
      danglingPolicy: 'graceful-degrade',
    });
    expect(artifactRegistry.plans.binding).not.toHaveProperty('contextType');
  });

  it('[ac:ac-m36-fiksuje-scheme-sekcji-konsumenta] the consumer section schema is root kind + `binding` + `danglingPolicy` + cross-link; directory, header contract, flags and reactions come from the root kind declaration, which each consumer fills', () => {
    for (const rootKind of ROOT_KINDS) {
      // Field "rodzaj korzenia": the key names a root kind with its own L13
      // declaration — a system root in code, hidden, with a markdown file-map
      // entry that carries the header contract.
      const decl = KIND_DECLARATIONS[rootKind];
      expect(decl.kind).toBe(rootKind);
      expect(decl.source).toBe('code');
      expect(decl.sidebar).toBe('hidden');
      const contract = headerContractOf(rootKind);
      expect(contract, rootKind).toBeDefined();
      // Artifacts are out of the release and never section-indexed — the kind says so.
      expect(decl.flags.release).toBe(false);
      expect(decl.reactions).not.toContain('m06-section-indexer');

      // Fields `binding` + `danglingPolicy`: exactly what the entry carries.
      expect(Object.keys(artifactRegistry[rootKind]).sort()).toEqual(['binding', 'danglingPolicy']);

      // Cross-link: the generic REST/read family `/api/artifacts/:kind` resolves
      // the same entry and reads the header contract from the root kind.
      const kind = ARTIFACT_KIND_OF_ROOT_KIND[rootKind];
      expect(ARTIFACT_ROOT_KIND[kind]).toBe(rootKind);
      expect(artifactRootId(kind)).toBe(rootKind);
      expect(artifactEntry(kind)).toBe(artifactRegistry[rootKind]);
      expect(artifactHeaderContract(kind)).toBe(contract);
      expect(Object.keys(ARTIFACT_READ_FAMILY[kind]).sort()).toEqual(['getWithWindow', 'list', 'responseBudget', 'search']);
    }

    // M10 fills it with its kind: `plans` — contract with `title` and `applied`
    // mutable, `type`/`created_at`/`created_by` immutable, no `id`.
    const plan = headerContractOf('plans')!;
    expect(plan.type).toBe('plan');
    expect([...plan.mutable].sort()).toEqual(['applied', 'title']);
    expect([...plan.immutable]).toEqual(expect.arrayContaining(['type', 'created_at', 'created_by']));
    expect(plan.immutable).not.toContain('id');
  });
});

/**
 * 2.1.13 — M36 keeps the binding matrix but loses its own parameter-shape rule.
 * The matrix supplies the address (which artifact is pinned to the thread); the
 * shape of the addressing parameter belongs to M43 `explicit-addressing`.
 */
describe('M36 binding matrix supplies the address, M43 shapes the parameter (2.1.13)', () => {
  const KINDS: ArtifactKind[] = ['brief', 'patch', 'plan'];
  const thread = { briefPath: 'b.md', patchPath: 'p.md', planPath: 'plan.md' };

  it('[section:m36bind01] the internal rendering takes each kind\'s address from its chat_thread column; nothing pinned → no address', () => {
    expect(bindingAddress('brief', thread)).toBe('b.md');
    expect(bindingAddress('patch', thread)).toBe('p.md');
    expect(bindingAddress('plan', thread)).toBe('plan.md');
    const empty = { briefPath: null, patchPath: null, planPath: null };
    for (const kind of KINDS) expect(bindingAddress(kind, empty), kind).toBeNull();
    expect(bindingAddress('plan', { ...empty, planPath: '' })).toBeNull();
  });

  it('[section:m36bind01] the matrix carries no parameter-shape rule: entries hold only binding (mode, contextType, threadColumn) and danglingPolicy, and the shape comes from explicit-addressing', () => {
    for (const rootKind of ROOT_KINDS) {
      const entry = artifactRegistry[rootKind] as unknown as Record<string, unknown>;
      expect(Object.keys(entry).sort(), rootKind).toEqual(['binding', 'danglingPolicy']);
      for (const k of Object.keys(entry.binding as object)) {
        expect(['mode', 'contextType', 'threadColumn'], `${rootKind}.binding.${k}`).toContain(k);
      }
    }
    // The shape follows the OWNER's declaration, not the matrix's anchor /
    // attach mode: patch (anchor, no declaration) keeps the optional default;
    // brief (anchor) and plan (attach) are absent only because their owners —
    // M21 (2.1.14) and M10 — declare isolation.
    expect(Object.keys(OWNER_THREAD_ISOLATION).sort()).toEqual(['brief', 'plan']);
    expect(artifactAddressingShape('brief', 'internal')).toBe('absent');
    expect(artifactAddressingShape('brief', 'internal', {})).toBe('optional');
    expect(artifactAddressingShape('patch', 'internal')).toBe('optional');
    expect(artifactAddressingShape('plan', 'internal')).toBe('absent');
    expect(artifactAddressingShape('plan', 'internal', {})).toBe('optional');
    for (const kind of KINDS) {
      expect(artifactAddressingShape(kind, 'rest'), kind).toBe('required');
    }
  });

  it('[section:jg79a7q4] one source of the address for all three kinds: each kind reads its own column of the same thread, never another kind\'s', () => {
    const columns = KINDS.map((kind) => artifactEntry(kind).binding.threadColumn);
    expect(new Set(columns).size).toBe(KINDS.length);
    // A thread pinned to a brief and a plan at once (per-kind columns coexist):
    const both = { briefPath: 'b.md', patchPath: null, planPath: 'plan.md' };
    expect(bindingAddress('brief', both)).toBe('b.md');
    expect(bindingAddress('plan', both)).toBe('plan.md');
    expect(bindingAddress('patch', both)).toBeNull();
  });
});
