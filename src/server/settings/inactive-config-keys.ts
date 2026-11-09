import { setInactiveConfigPaths } from '../config.js';
import { hostProjectTypeRegistry } from '../project-types/registry.js';
import { projectCapabilitySet } from '../project-types/capabilities.js';
import { fieldPath } from './field-registry.js';
import { STATIC_FIELD_REGISTRY } from './registry.js';

/**
 * 2.1.77 (M26 `hozcm4w5`, L17 `Wymaga możliwości`) — installs, into the
 * `config.json` reader/writer, the rule "a key whose required capability the
 * project's type lacks does not exist for the project": the normalizer of
 * `readConfig` skips it and `writeConfig` keeps it in the file untouched. The
 * type is settled first (its entry in the project-type registry gives the
 * capability set), then the keys — the layer's field tables, filtered by their
 * `requires`. A type the registry does not know makes no key inactive: the
 * activation refuses such a project anyway (`PROJECT_TYPE_UNKNOWN`).
 *
 * Called at process start, right after the project-type registry is built.
 */
export function installInactiveConfigKeys(): void {
  const cache = new Map<string, readonly (readonly string[])[]>();
  setInactiveConfigPaths((projectType) => {
    const hit = cache.get(projectType);
    if (hit) return hit;
    const entry = hostProjectTypeRegistry().get(projectType);
    const paths = entry
      ? STATIC_FIELD_REGISTRY.inactiveKeys(projectCapabilitySet(entry.capabilities)).map((key) =>
          fieldPath(STATIC_FIELD_REGISTRY.get(key)!),
        )
      : [];
    cache.set(projectType, paths);
    return paths;
  });
}
