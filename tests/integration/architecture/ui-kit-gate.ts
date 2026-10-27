/**
 * M34/L12 `hntah0r7` — the automatic check of gate (a), "one implementation".
 *
 * Scope: the host code (`src/client/**`, the catalog folder itself excluded)
 * and the sources of every envelope (`plugins/<package>/src/**`). Out of scope
 * are the two surfaces the gate's reach excludes from L12 — the editor surface
 * (M20) and the chat overlay (M53): own markup there is no violation and needs
 * no declaration.
 *
 * Exceptions: read from `HOST_LOCAL_DECLARATIONS` and nothing else — the DŁUG,
 * host-internal and local entries of the consumers' `Host-local components`
 * fields. The rest of the rule (locality conditions, the `connected` gate)
 * stays a manual criterion.
 *
 * Two detectors, both text scans of the sources (no DOM here, the same approach
 * `styles/theme.test.ts` takes for CSS invariants):
 * - **anatomy** — markup reproducing the anatomy of an overlay the catalog
 *   owns: a full-viewport scrim with a centred panel (`Dialog`), a panel on the
 *   `--z-popover` tier (`Popover`), a stack on the `--z-toast` tier
 *   (`ToastViewport`). Host and envelopes alike.
 * - **kit markup** — an envelope's `frontend-kit/` is where shared UI is
 *   vendored into a package. A `frontend-kit/` file that renders intrinsic
 *   markup of its own (rather than composing catalog components) is a
 *   host-local component, and is legal only when declared.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_LOCAL_DECLARATIONS, type HostLocalDeclaration } from './host-local-declarations.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The catalog folder — the one place catalog anatomy may live. */
export const CATALOG_DIR = 'src/client/host-ui-kit/';

/**
 * Surfaces outside L12 (M34 `hntah0r7`, "Zasięg bramki (a)"), by path prefix.
 * The chat's raw tool-JSON window lives under `ui/modals/` but is opened only
 * from chat tool cards — it is the chat overlay's, not a slice of L12.
 */
export const OUT_OF_L12_SCOPE: Readonly<Record<string, string>> = {
  'src/client/chat/': 'M53 — chat overlay',
  'src/client/ui/modals/ToolJsonView.tsx': 'M53 — chat overlay (the tool-json-view window of chat tool cards)',
  'src/client/tiptap/': 'M20 — editor surface',
};

export const ANATOMY_DETECTORS: ReadonlyArray<{ component: string; pattern: RegExp }> = [
  { component: 'Popover', pattern: /var\(--z-popover\)/ },
  { component: 'ToastViewport', pattern: /var\(--z-toast\)/ },
  // A modal twin is a full-viewport scrim with a centred panel, however its
  // stacking happens to be spelled — `Dialog`'s own z-index (1200/1300) or
  // Tailwind's `z-50` with `items-center justify-center` (which is what
  // separates a dialog from a fullscreen viewer laid out `flex flex-col`).
  { component: 'Dialog', pattern: /zIndex:\s*1[23]00|fixed inset-0[^"]*items-center justify-center/ },
];

/** Intrinsic elements that make a `frontend-kit/` file own markup. */
const INTRINSIC =
  /<(div|span|button|main|section|header|footer|nav|aside|ul|ol|li|a|p|h[1-6]|input|select|option|textarea|label|form|table|thead|tbody|tr|td|th|img|svg|pre|code|iframe|strong|em|small)[\s/>]/;

/** A `DEBT (…, Host UI Kit …)` header — the in-code mark of a DŁUG entry. */
export const DEBT_MARKER = /\bDEBT \([^)]*Host UI Kit[^)]*\)/;
/** The in-code mark of a host-internal component. */
export const HOST_INTERNAL_MARKER = /\bHOST-INTERNAL COMPONENT\b/;

export interface Finding {
  file: string;
  detector: string;
}

const toRepoPath = (abs: string): string => relative(REPO_ROOT, abs).split(sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'out') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block and line comments, so prose about markup is not markup. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

export function isOutOfScope(file: string): boolean {
  return Object.keys(OUT_OF_L12_SCOPE).some((prefix) => file === prefix || file.startsWith(prefix));
}

/** Host sources in L12's reach, repo-relative. */
export function hostFiles(): string[] {
  return walk(join(REPO_ROOT, 'src/client'))
    .map(toRepoPath)
    .filter((f) => !f.startsWith(CATALOG_DIR) && !isOutOfScope(f))
    .sort();
}

/** The sources of every envelope (`plugins/<package>/src/**`), repo-relative. */
export function envelopeFiles(): string[] {
  const out: string[] = [];
  for (const pkg of readdirSync(join(REPO_ROOT, 'plugins'))) {
    const src = join(REPO_ROOT, 'plugins', pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push(...walk(src).map(toRepoPath));
  }
  return out.sort();
}

const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/** `true` when a source renders intrinsic markup of its own. */
export function ownsMarkup(file: string): boolean {
  return INTRINSIC.test(stripComments(read(file)));
}

/** Every detector hit, before any declaration is applied. */
export function scanFindings(): Finding[] {
  const findings: Finding[] = [];
  for (const file of [...hostFiles(), ...envelopeFiles()]) {
    const src = read(file);
    for (const { component, pattern } of ANATOMY_DETECTORS) {
      if (pattern.test(src)) findings.push({ file, detector: `anatomy:${component}` });
    }
    if (/^plugins\/[^/]+\/src\/frontend-kit\/[^/]+\.tsx$/.test(file) && ownsMarkup(file)) {
      findings.push({ file, detector: 'kit-markup' });
    }
  }
  return findings;
}

/** Findings no declaration covers — gate (a) violations. */
export function violations(declarations: readonly HostLocalDeclaration[] = HOST_LOCAL_DECLARATIONS): Finding[] {
  const declared = new Set(declarations.flatMap((d) => d.files));
  return scanFindings().filter((f) => !declared.has(f.file));
}

/** In-scope sources carrying a `DEBT (…, Host UI Kit …)` header. */
export function debtMarkedFiles(): string[] {
  return [...hostFiles(), ...envelopeFiles()].filter((f) => DEBT_MARKER.test(read(f)));
}

/** In-scope sources carrying a `HOST-INTERNAL COMPONENT` header. */
export function hostInternalMarkedFiles(): string[] {
  return [...hostFiles(), ...envelopeFiles()].filter((f) => HOST_INTERNAL_MARKER.test(read(f)));
}

export function filesOfKind(kind: HostLocalDeclaration['kind']): string[] {
  return [...new Set(HOST_LOCAL_DECLARATIONS.filter((d) => d.kind === kind).flatMap((d) => d.files))].sort();
}

export function readSource(file: string): string {
  return read(file);
}
