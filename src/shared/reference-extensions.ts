import { XML_TAG_KINDS } from './xml-tag-kinds.js';

export interface ExtensionReferenceValidateResult {
  ok: boolean;
  category: string;
}

export interface ExtensionReferenceType {
  tag: string;
  attrOrder: readonly string[];
  /**
   * v0.1.129 (M19) — the entity type this tag's `slug` attribute resolves
   * against, e.g. `'diagram'`. Enables generic broken-reference detection in
   * `check_consistency` (any registered extension type with an `entityType`
   * gets existence checking for free, no per-tag code). Extensions with no
   * backing entity (e.g. `section_ref`, resolved by anchor via SectionsService)
   * leave this unset.
   */
  entityType?: string;
  validate?: (attrs: Record<string, string>) => ExtensionReferenceValidateResult;
}

const registry = new Map<string, ExtensionReferenceType>();

/**
 * `validate` is compared by PRESENCE, not reference identity — a hot-reloaded
 * plugin module is re-evaluated fresh on every rebuild (overlay-loader's
 * content-hash cache-bust forces a new `import()`), which always produces a
 * new closure even when the plugin's source is logically unchanged. Comparing
 * `a.validate === b.validate` made every hot-reload of a plugin with a
 * `validate` closure look like a genuine conflict, defeating the very
 * idempotency this function exists to provide. There is no way to deep-compare
 * closures, so "both present or both absent" is the closest available proxy —
 * `attrOrder`/`entityType`/`tag` remain exact-compared since those are plain
 * data.
 *
 * Exported (not just an internal `classify` helper) so callers that need to
 * dedup a BATCH of contributions against each other — before any of them hit
 * the real registry — can reuse the exact same equivalence rule, e.g.
 * `PluginRegistryImpl.registerPlugin` detecting two entries of the same
 * manifest that redeclare the same tag differently.
 */
export function sameExtensionReferenceSpec(a: ExtensionReferenceType, b: ExtensionReferenceType): boolean {
  return (
    a.tag === b.tag &&
    a.entityType === b.entityType &&
    Boolean(a.validate) === Boolean(b.validate) &&
    JSON.stringify(a.attrOrder) === JSON.stringify(b.attrOrder)
  );
}

type Classification =
  | { kind: 'invalid'; message: string }
  | { kind: 'shadowed' }
  | { kind: 'conflict'; message: string }
  | { kind: 'noop' }
  | { kind: 'ok' };

function classify(spec: ExtensionReferenceType): Classification {
  if (!/^[a-z][a-z0-9_]*$/.test(spec.tag)) {
    return { kind: 'invalid', message: `Invalid extension reference tag: ${spec.tag}` };
  }
  if ((XML_TAG_KINDS as readonly string[]).includes(spec.tag)) {
    return { kind: 'shadowed' };
  }
  const existing = registry.get(spec.tag);
  if (existing) {
    return sameExtensionReferenceSpec(existing, spec)
      ? { kind: 'noop' }
      : {
          kind: 'conflict',
          message: `Extension reference tag "${spec.tag}" is already registered with a different definition — tags must be unique across all extension sources`,
        };
  }
  return { kind: 'ok' };
}

/**
 * Non-mutating pre-check — the exact classification `registerExtensionReferenceType`
 * itself uses, exposed so a caller registering a BATCH of contributions in one
 * logical unit (e.g. `PluginRegistryImpl.registerPlugin`, across several entity
 * modules' Slot B tags plus a manifest's Slot A tags) can validate the whole
 * batch atomically before committing ANY of it — preventing a partial commit
 * where an earlier contribution in the batch stays live with no rollback path
 * if a later one in the same batch conflicts.
 *
 * Returns an error message for anything that would actually throw (invalid
 * tag / genuine conflict); `null` for anything that would succeed OR silently
 * no-op (shadowed / identical re-registration) — those never need to block a
 * batch.
 */
export function wouldConflictExtensionReferenceType(spec: ExtensionReferenceType): string | null {
  const result = classify(spec);
  return result.kind === 'invalid' || result.kind === 'conflict' ? result.message : null;
}

/**
 * Registers a self-closing XML reference tag. Fails fast on a duplicate tag
 * from two extension sources (v0.1.129) — the previous silent last-write-wins
 * behavior let one plugin's tag silently clobber another's. A tag that shadows
 * a core kind (`XML_TAG_KINDS`) is rejected with a warning instead of thrown —
 * core always wins, the extension is shadowed and reported, not fatal.
 *
 * Re-registering the SAME tag with an identical spec is a silent no-op, not a
 * conflict — this registry is a process-global singleton, but `registerPlugin`/
 * `registerEntityModule` are designed to be replayed against a fresh
 * `PluginRegistry` instance (every test app build, hot-reload) rather than
 * called exactly once per process. Only a tag re-claimed with a DIFFERENT
 * definition is a genuine conflict.
 */
export function registerExtensionReferenceType(spec: ExtensionReferenceType): void {
  const result = classify(spec);
  switch (result.kind) {
    case 'invalid':
    case 'conflict':
      throw new Error(result.message);
    case 'shadowed':
      console.warn(
        `[reference-extensions] tag "${spec.tag}" shadows a core XML tag kind — core wins, extension registration ignored`,
      );
      return;
    case 'noop':
      return;
    case 'ok':
      registry.set(spec.tag, spec);
      return;
  }
}

export function getExtensionReferenceType(tag: string): ExtensionReferenceType | undefined {
  return registry.get(tag);
}

export function listExtensionReferenceTypes(): ExtensionReferenceType[] {
  return Array.from(registry.values());
}

export function clearExtensionReferenceTypes(): void {
  registry.clear();
}
