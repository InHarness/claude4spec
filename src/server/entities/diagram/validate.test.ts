import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateDiagramSource } from './validate.js';

/**
 * Regression suite for the DOMPurify false positive: mermaid.parse() needs a
 * DOM to initialize DOMPurify, and without one it threw
 * `TypeError: DOMPurify.addHook is not a function` on perfectly valid sources.
 * The first case here pays the one-time DOM + mermaid import (~350 ms).
 */

const VALID: Record<string, string> = {
  classDiagram: 'classDiagram\n  class Foo {\n    +bar()\n  }',
  'stateDiagram-v2': 'stateDiagram-v2\n  [*] --> A\n  A --> [*]',
  gantt: 'gantt\n  title A\n  section S\n  T1 :a1, 2024-01-01, 30d',
  pie: 'pie title X\n  "a" : 10',
  journey: 'journey\n  title My day\n  section Go\n    Wake: 5: Me',
  mindmap: 'mindmap\n  root((hi))\n    a\n    b',
  'flowchart with an HTML label': 'flowchart TD\n  A["<b>bold</b>"] --> B',
  'sequenceDiagram with accTitle': 'sequenceDiagram\n  accTitle: My title\n  A->>B: hi',
  // Already parsed fine before the fix — kept so a regression the other way shows up too.
  sequenceDiagram: 'sequenceDiagram\n  A->>B: hi',
  erDiagram: 'erDiagram\n  A ||--o{ B : has',
  flowchart: 'flowchart TD\n  A-->B',
};

const MALFORMED: Record<string, string> = {
  classDiagram: 'classDiagram\n  class Foo {\n    +bar()\n  ]]] &&& [[[',
  'stateDiagram-v2': 'stateDiagram-v2\n  [*] --> A\n  --> --> -->',
  gantt: 'gantt\n  title A\n  ]]] &&& [[[',
  pie: 'pie title X\n  ]]] &&&',
  journey: 'journey\n  title X\n  ]]] &&& [[[',
  mindmap: 'mindmap\n  root((hi))\n    a\n  ]]] &&& [[[',
  'flowchart with an HTML label': 'flowchart TD\n  A["<b>b</b>"] --> B\n  ]]] &&& [[[',
  sequenceDiagram: 'sequenceDiagram\n  ]]] &&& [[[',
  'no diagram type at all': 'this is not a diagram at all',
};

describe('validateDiagramSource', () => {
  describe('valid sources produce no warnings (no DOMPurify false positive)', () => {
    for (const [name, source] of Object.entries(VALID)) {
      it(`${name} → []`, async () => {
        expect(await validateDiagramSource('mermaid', source)).toEqual([]);
      });
    }
  });

  describe('genuinely malformed sources still warn — and never about DOMPurify', () => {
    for (const [name, source] of Object.entries(MALFORMED)) {
      it(`${name} → exactly one syntax warning`, async () => {
        const warnings = await validateDiagramSource('mermaid', source);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/^mermaid source may be invalid: /);
        expect(warnings[0]).not.toMatch(/DOMPurify/);
      });
    }
  });

  it('warns on "valid first statement, then garbage" (locks out silencing the TypeError)', async () => {
    // With the rejected "treat a DOMPurify TypeError as cannot-validate" variant
    // this source validated clean, because DOMPurify blew up before the parser
    // ever reached the garbage — a false negative.
    const warnings = await validateDiagramSource(
      'mermaid',
      'classDiagram\n  class Foo {\n    +bar()\n  }\n  ]]] &&& [[[',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toMatch(/DOMPurify/);
  });

  it('stays silent for a non-mermaid format', async () => {
    expect(await validateDiagramSource('d2', 'anything at all')).toEqual([]);
  });

  it('stays silent for an empty or whitespace-only source', async () => {
    expect(await validateDiagramSource('mermaid', '')).toEqual([]);
    expect(await validateDiagramSource('mermaid', '   \n\t ')).toEqual([]);
  });

  it('restores every DOM global it installs, byte-for-byte', async () => {
    // All eight keys the implementation touches. `navigator` is the interesting
    // one: it already exists natively on Node >= 21, so it is the only entry
    // that takes the save-and-restore-descriptor path rather than the delete
    // path — exactly the branch that could leave happy-dom's navigator behind.
    const keys = [
      'window',
      'document',
      'DOMParser',
      'Node',
      'Element',
      'HTMLElement',
      'NodeFilter',
      'navigator',
    ];
    const before = keys.map((k) => Object.getOwnPropertyDescriptor(globalThis, k));

    await validateDiagramSource('mermaid', VALID.classDiagram);

    keys.forEach((key, i) => {
      const after = Object.getOwnPropertyDescriptor(globalThis, key);
      expect(after, `globalThis.${key} changed across validation`).toEqual(before[i]);
    });
  });

  // The DOM must not keep a CLI process alive after a validation. That can only
  // be observed from outside the process — in-process handle counts are polluted
  // by vitest's own timers — so this spawns one short-lived child. Skipped rather
  // than failed when `tsx` is absent, so a missing dev toolchain never looks like
  // a leaked-timer regression.
  const tsxAvailable = (() => {
    try {
      createRequire(import.meta.url).resolve('tsx');
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!tsxAvailable)('does not keep the event loop alive — a CLI process exits cleanly', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const modulePath = pathToFileURL(path.join(here, 'validate.ts')).href;
    // execFileSync throws on a non-zero exit *and* on the timeout, so a process
    // held open by a leaked happy-dom handle fails here instead of hanging.
    const out = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `const { validateDiagramSource } = await import(${JSON.stringify(modulePath)});
         const warnings = await validateDiagramSource('mermaid', 'classDiagram\\n  class Foo {\\n    +bar()\\n  }');
         process.stdout.write(JSON.stringify(warnings));`,
      ],
      {
        cwd: path.resolve(here, '../../../..'),
        timeout: 30_000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(out).toBe('[]');
  });
});
