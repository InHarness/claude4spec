/**
 * The Single Abstraction Rule, as falsifiable tests.
 *
 * 0.2.2 generalized the rule: it stopped being an enumeration of type literals
 * and became structural — the host resolves a type through the registry, reads
 * `module.table` from the manifest, and gets its service by shape. The four
 * greps below are the brief's own verification gates. They lived only in the
 * brief, which meant nothing stopped them rotting; here they fail a build.
 *
 * Scope note for every gate: a hit inside `entities/` (types built in directly)
 * or inside an envelope's `plugins/<name>/src/` is BY DEFINITION fine — that is
 * the package that contributes the type. The rule is about the host core.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const SRC = path.join(REPO_ROOT, 'src');

/**
 * Every `.ts`/`.tsx` under `src/`, excluding the directories that OWN a type.
 *
 * The exemption is `entities/<type>/`, one directory per type — not the whole
 * `entities/` tree. Skipping the tree wholesale also exempted
 * `src/client/entities/_shared/`, which owns no type at all: it is cross-cutting
 * host code, and it held four `type === '<literal>'` branches that this gate
 * exists to forbid. The rule was asserting the host does not branch on entity
 * types while looking away from the one place it did.
 *
 * `_`-prefixed children of `entities/` are therefore scanned; a real type
 * directory is not. `entities/index.ts` and `registry.tsx` sit directly in the
 * tree and are scanned too, which is correct — they are the registry, not a type.
 */
function hostSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, insideEntities: boolean) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // A per-type directory: this is where a type legitimately knows its name.
        if (insideEntities && !entry.name.startsWith('_')) continue;
        walk(abs, entry.name === 'entities');
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(abs);
      }
    }
  };
  walk(SRC, false);
  return out;
}

/**
 * Comment lines are stripped before matching. Every gate here has prose hits —
 * the rule is discussed at length in docblocks, including by quoting the very
 * pattern being searched for — and a rule that fires on its own documentation
 * teaches people to delete the documentation.
 */
function codeLines(file: string): Array<{ line: number; text: string }> {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const out: Array<{ line: number; text: string }> = [];
  let inBlock = false;
  lines.forEach((text, i) => {
    const trimmed = text.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    out.push({ line: i + 1, text });
  });
  return out;
}

function hits(pattern: RegExp, filter: (file: string) => boolean = () => true): string[] {
  const found: string[] = [];
  for (const file of hostSourceFiles()) {
    if (!filter(file)) continue;
    for (const { line, text } of codeLines(file)) {
      if (pattern.test(text)) found.push(`${path.relative(REPO_ROOT, file)}:${line}: ${text.trim()}`);
    }
  }
  return found;
}

/** Test doubles and fixtures name types on purpose — that is what they are for. */
const isProduction = (file: string) => !/\.test\.tsx?$/.test(file) && !file.includes('__fixtures__');

describe('Single Abstraction Rule', () => {
  it('only the plugin host reads `config.entities`', () => {
    // `config.entitiesDir` is a different field (a filesystem path) and does not
    // count; the boundary is the `\b` after `entities`.
    expect(
      hits(/config\.entities\b/, (f) => isProduction(f) && !f.includes('core/plugin-host/')),
    ).toEqual([
      // The settings screen whose whole job is EDITING the activation set. It
      // reads the field as data, which is the opposite of dispatching on it.
      expect.stringContaining('EntitiesSection.tsx'),
      // A user-facing sentence that happens to name the field.
      expect.stringContaining('BrokenChip.tsx'),
      // Pass-through, not dispatch: the project config is copied verbatim into
      // the release bundle so a restore can reproduce the activation set.
      expect.stringContaining('release-bundle.ts'),
      // A user-facing sentence that happens to name the field: the refusal when
      // a bundle carries a type this installation has deactivated tells the
      // reader where to go and fix it. Naming a setting is not dispatching on it.
      //
      // 0.2.24 moved this sentence from `release.ts` into the bundle module with
      // the rest of the layout's read direction. The activation TEST is still
      // not made here — `readBundleEntities` takes an `isActive` predicate the
      // host supplies, which is the whole reason the module can stay pure.
      expect.stringContaining('release-bundle.ts'),
    ]);
  });

  it('the host does not branch on an entity type literal', () => {
    const ENTITY_TYPES = ['endpoint', 'dto', 'ui-view', 'ac', 'design-system', 'diagram', 'database-table'];
    const pattern = new RegExp(`type === '(${ENTITY_TYPES.join('|')})'`);
    /*
     * ZERO, with no exemption — as of 0.2.18.
     *
     * The `endpoint`/`dto`/`database-table` branches went when those types left
     * the host in 0.2.2/0.2.11. The last live one was `ui-view`'s crumb in
     * `_shared/EntityBreadcrumbBar.tsx`, and the note here used to say it needed
     * a host-API addition to remove, because `FrontendModule` has no slot for a
     * per-type crumb. It did not: `ui-view` and `design-system` moved into the
     * `c4s-plugin-frontend-mockups` envelope, which vendors its own breadcrumb
     * bar the way `c4s-plugin-api-contracts` already did, and the host's copy is
     * now branchless.
     *
     * The type names STAY in `ENTITY_TYPES` above. The pattern is what forbids a
     * branch coming back; forgetting a retired name would quietly stop forbidding
     * it.
     */
    expect(hits(pattern, isProduction)).toEqual([]);
  });

  /**
   * 0.2.11 — the falsifiable form of "the release tier enumerates no entity
   * type". This tier held three separate hardcoded lists: the snapshot's covered
   * types, the bundle's singular→plural file-name map, and the bundle-restore
   * order. Each silently dropped whatever it did not name, and the three did not
   * even agree with each other.
   *
   * Exact-zero is achievable because the surviving mentions in these files are
   * all prose in comments, which `codeLines()` strips.
   */
  it('the release tier enumerates no entity type', () => {
    const files = ['release.ts', 'release-bundle.ts', 'release-push.ts'].map((f) =>
      path.join(REPO_ROOT, 'src', 'server', 'services', f),
    );
    const pattern = /['"](endpoint|dto|database-table|ui-view|ac|design-system|diagram)['"]/;
    expect(hitsIn(files, pattern)).toEqual([]);
  });

  /**
   * 0.2.11 — likewise for the MCP release tools, which re-narrowed to the same
   * five one layer above `ReleaseService`: a whitelist in `projection.ts` and a
   * closed zod enum in `index.ts`. Left in place, they would have hidden the
   * newly-covered types from the brief-authoring agent, which is the main
   * consumer of these tools.
   */
  it('the MCP release tools enumerate no entity type', () => {
    const dir = path.join(REPO_ROOT, 'src', 'server', 'mcp', 'release-tools');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(dir, f));
    const pattern = /['"](endpoint|dto|database-table|ui-view|ac|design-system|diagram)['"]/;
    expect(hitsIn(files, pattern)).toEqual([]);
  });

  it('no entity service CLASS is imported outside the package that owns it', () => {
    expect(hits(/import .*Service.*from '.*(entities|plugins)\//, isProduction)).toEqual([]);
  });

  it('no type-specific API route literal lives in the host', () => {
    // `/api/ui-views` is legitimate inside `src/client/entities/ui-view/` — that
    // IS the contributing package — and `hostSourceFiles` already excludes it.
    expect(hits(/['"`]\/api\/(endpoints|dtos)\b/, isProduction)).toEqual([]);
  });

  it('the host never names the endpoint↔dto junction', () => {
    // Item 5's acceptance criterion. `db/migrations/*.sql` is exempt and not
    // scanned here: those files are an applied ledger, replayed verbatim by every
    // installed database, and editing one would change history.
    expect(hits(/endpoint_dto/, isProduction)).toEqual([]);
  });
});

/**
 * Every file under a per-type directory — the exact set `hostSourceFiles()`
 * deliberately skips.
 *
 * The gates above police the HOST for knowledge it should not have. The two
 * below police the TYPES for a decision that is no longer theirs to make: since
 * 0.2.4 a service does not mint its own timestamps and a serializer does not
 * know the entity has any. Both regressions would be invisible — a service that
 * quietly re-adds `datetime('now')` still passes its own tests, and the file it
 * writes just starts drifting from its row.
 */
function typePackageFiles(match: RegExp): string[] {
  const roots = [path.join(SRC, 'server', 'entities'), path.join(REPO_ROOT, 'plugins')];
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(abs);
      } else if (match.test(entry.name)) {
        out.push(abs);
      }
    }
  };
  for (const root of roots) walk(root);
  return out;
}

function hitsIn(files: string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    if (/\.test\.tsx?$/.test(file)) continue;
    for (const { line, text } of codeLines(file)) {
      if (pattern.test(text)) found.push(`${path.relative(REPO_ROOT, file)}:${line}: ${text.trim()}`);
    }
  }
  return found;
}

describe('0.2.4 — the file owns the timestamps', () => {
  it('no entity service mints its own timestamp — there is no entity service left to do it', () => {
    /**
     * `datetime('now')` in a service was the pre-0.2.4 behaviour verbatim: it
     * made the COLUMN authoritative and the file derived, inverting the
     * direction that tier establishes. A rebuild is a write, so every such call
     * turned "the indexer ran" into "the content changed".
     *
     * 2.0.0 tier K settles it by removing the category. The six per-type CRUD
     * services are deleted; timestamps are resolved once, by the host, in
     * `serialization/system-fields.ts`.
     *
     * 0.2.28 — and the `datetime('now')` scan, kept then because it "costs
     * nothing", is now the whole assertion. `design-system` registers the first
     * real `backend.service`: a stateless domain helper (token `resolve()` plus
     * the CSS sheet generator), which the Host API has always allowed on that
     * slot. So "there are no service files" stopped being true without anything
     * this case cares about having changed. What it cares about is that no such
     * file mints a timestamp — which is exactly what the scan says, and it now
     * has a file to say it about.
     */
    const services = typePackageFiles(/^services?\.ts$/);
    expect(hitsIn(services, /datetime\('now'\)/)).toEqual([]);
    // Sanity on the SCANNER, not on the corpus: `service.ts` files are optional
    // — deleting the one that exists is a legal refactor, and it must not fail
    // a case whose message is about timestamps. What must not silently pass is
    // `typePackageFiles` reaching nothing at all, so the check anchors on a file
    // every type has.
    expect(typePackageFiles(/^index\.ts$/).length).toBeGreaterThan(0);
  });

  it('no serializer knows the timestamps exist', () => {
    /**
     * The envelope is attached and detached at the three host chokepoints in
     * `serialization/snapshot.ts`. A serializer that emits `createdAt` itself
     * would collide with the host's key on the way out and survive the strip on
     * the way in — the one collision the flat top-level envelope is only safe
     * without.
     */
    // 0.2.23: the file is `serializer.ts`. It was `views.ts` for as long as a
    // serializer's substance was computed views; with those gone it is a payload
    // timeline and an optional `diff`, and the name follows. Scanning the old
    // one would find nothing and pass — hence the length floor below.
    const serializers = typePackageFiles(/^serializer\.ts$/);
    expect(serializers.length).toBeGreaterThan(3);
    expect(hitsIn(serializers, /\bcreatedAt\b|\bupdatedAt\b/)).toEqual([]);
  });
});

/**
 * Where the payload-upgrade chain may be run from.
 *
 * The one-time-rewrite guarantee is not enforced by bookkeeping — it holds
 * because every call site handles a WHOLE entity payload and rewrites the file
 * once afterwards. A partial read that ran the chain (tier C's keyed-collection
 * windows are the obvious future candidate) would either re-run migrations per
 * window or rewrite a file from a fragment. Neither fails loudly.
 *
 * So the invariant is stated as a scope rule instead: the runner is reachable
 * only from the entrances that own a whole payload. Adding a fifth is a
 * deliberate act that edits this list.
 */
describe('payload upgrades run only at the whole-entity entrances', () => {
  const ALLOWED = [
    // The chain and its own tests.
    'serialization/payload-upgrade.ts',
    // M29 — load and full rebuild from disk.
    'services/entity-indexer.ts',
    // M17 — release snapshots, bundle import, and the diff that compares them.
    'services/release.ts',
    // Per-entity version restore. See the clarification patch filed against the brief.
    'services/versions.ts',
  ];

  it('nothing outside the declared entrances calls upgradePayload', () => {
    const offenders = hostSourceFiles()
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => !ALLOWED.some((allowed) => f.endsWith(allowed)))
      .filter((f) => codeLines(f).some((l) => /\bupgradePayload\s*\(/.test(l.text)))
      .map((f) => path.relative(SRC, f));

    expect(offenders, `upgradePayload called outside the declared entrances`).toEqual([]);
  });
});
