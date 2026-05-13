export interface ExtensionReferenceValidateResult {
  ok: boolean;
  category: string;
}

export interface ExtensionReferenceType {
  tag: string;
  attrOrder: readonly string[];
  validate?: (attrs: Record<string, string>) => ExtensionReferenceValidateResult;
}

const registry = new Map<string, ExtensionReferenceType>();

export function registerExtensionReferenceType(spec: ExtensionReferenceType): void {
  if (!/^[a-z][a-z0-9_]*$/.test(spec.tag)) {
    throw new Error(`Invalid extension reference tag: ${spec.tag}`);
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
