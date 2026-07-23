import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
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

  it('leaves no fake DOM globals behind in the process', async () => {
    await validateDiagramSource('mermaid', VALID.classDiagram);
    const g = globalThis as unknown as Record<string, unknown>;
    for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'NodeFilter']) {
      expect(g[key], `globalThis.${key} should not survive validation`).toBeUndefined();
    }
  });

  it('does not keep the event loop alive — a CLI process exits cleanly after validating', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '../../../..');
    const modulePath = pathToFileURL(path.join(here, 'validate.ts')).href;
    // Runs the real validator in a fresh process through tsx. `execFileSync`
    // throws on a non-zero exit *and* on the timeout, so a process kept alive
    // by a leaked happy-dom timer fails this test rather than hanging the run.
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
      { cwd: repoRoot, timeout: 60_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out).toBe('[]');
  });
});
