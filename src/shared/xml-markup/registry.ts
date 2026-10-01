/**
 * M51 — XML Markup Registry. THE process-global registry of the self-closing
 * XML markup tags that live in markdown (`<inline_mention …/>`, `<section_ref …/>`,
 * `<todo …/>`, …). One per process: one on the server, one in the browser —
 * never per project, and it holds no project data (no key; created on module
 * import, released by GC).
 *
 * Membership is decided by an entry here, never by syntax: a name outside the
 * registry is plain text to every parser. Entries are added only by HOST
 * modules, by a direct call at startup (see `host-tags.ts`); a loaded plugin
 * never reaches this — an entity type contributes only its look (render slots).
 *
 * A registration is a pure declaration, identical on server and browser:
 * name + attribute order + optional pure `validate` + optional `form`. It
 * carries no parser/serializer (both are generic, `xml-tags.ts`) and no render
 * (assigned separately in the browser, `client/xml-markup/renders.ts`).
 */

export type XmlTagForm = 'inline' | 'block';

export interface XmlTagValidateResult {
  ok: boolean;
  category: string;
}

export interface XmlTagRegistration {
  /** Tag name — `snake_case`, unique across the whole system. */
  name: string;
  /** The order in which the serializer writes attributes. */
  attrOrder: readonly string[];
  /**
   * A PURE function of the attributes. It must not close over one project's
   * collaborators (e.g. a section index): the registry is process-global, so
   * such a closure would leak state between projects. A tag whose validity
   * depends on project state registers WITHOUT `validate`; its owner module
   * checks it against the current context (e.g. the consistency check).
   */
  validate?: (attrs: Record<string, string>) => XmlTagValidateResult;
  /** `inline` or `block`; absent = `block`. */
  form?: XmlTagForm;
}

export interface XmlTagDefinition {
  name: string;
  attrOrder: readonly string[];
  validate?: (attrs: Record<string, string>) => XmlTagValidateResult;
  form: XmlTagForm;
}

const NAME_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const registry = new Map<string, XmlTagDefinition>();
let version = 0;

/**
 * Registers a tag. A second registration of the same name is a hard error —
 * never a silent overwrite (last-wins) and never a no-op. Registration is
 * additive: it does not change the semantics of tags already registered.
 */
export function registerXmlTag(reg: XmlTagRegistration): void {
  if (!NAME_RE.test(reg.name)) {
    throw new Error(`Invalid XML tag name "${reg.name}" — tag names are snake_case`);
  }
  if (registry.has(reg.name)) {
    throw new Error(`XML tag "${reg.name}" is already registered — tag names must be unique across the system`);
  }
  if (reg.attrOrder.length === 0 || reg.attrOrder.some((a) => !/^\w+$/.test(a))) {
    throw new Error(`XML tag "${reg.name}" needs a non-empty attrOrder of plain attribute names`);
  }
  registry.set(reg.name, {
    name: reg.name,
    attrOrder: [...reg.attrOrder],
    ...(reg.validate ? { validate: reg.validate } : {}),
    form: reg.form ?? 'block',
  });
  version++;
}

export function getXmlTag(name: string): XmlTagDefinition | undefined {
  return registry.get(name);
}

export function isRegisteredXmlTag(name: string): boolean {
  return registry.has(name);
}

/** Registered tags in registration order. */
export function listXmlTags(): XmlTagDefinition[] {
  return Array.from(registry.values());
}

/** Bumps on every registration — lets derived caches (the tag pattern) invalidate. */
export function xmlTagsVersion(): number {
  return version;
}

/**
 * TEST-ONLY. Restore the registry to the given snapshot (by default: the one
 * taken by `snapshotXmlTagsForTests`). Production code never removes a tag —
 * there is no unregistration in the contract; tests that register a scratch
 * tag use this to keep the process-global registry from leaking between cases.
 */
export function snapshotXmlTagsForTests(): XmlTagDefinition[] {
  return listXmlTags();
}

export function restoreXmlTagsForTests(snapshot: XmlTagDefinition[]): void {
  registry.clear();
  for (const def of snapshot) registry.set(def.name, def);
  version++;
}
