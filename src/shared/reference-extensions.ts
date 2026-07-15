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

function sameSpec(a: ExtensionReferenceType, b: ExtensionReferenceType): boolean {
  return (
    a.tag === b.tag &&
    a.entityType === b.entityType &&
    a.validate === b.validate &&
    JSON.stringify(a.attrOrder) === JSON.stringify(b.attrOrder)
  );
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
  if (!/^[a-z][a-z0-9_]*$/.test(spec.tag)) {
    throw new Error(`Invalid extension reference tag: ${spec.tag}`);
  }
  if ((XML_TAG_KINDS as readonly string[]).includes(spec.tag)) {
    console.warn(
      `[reference-extensions] tag "${spec.tag}" shadows a core XML tag kind — core wins, extension registration ignored`,
    );
    return;
  }
  const existing = registry.get(spec.tag);
  if (existing) {
    if (sameSpec(existing, spec)) return;
    throw new Error(
      `Extension reference tag "${spec.tag}" is already registered with a different definition — tags must be unique across all extension sources`,
    );
  }
  registry.set(spec.tag, spec);
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
