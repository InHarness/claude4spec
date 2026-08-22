/**
 * The envelope's declaration, pinned.
 *
 * Deliberately NO `[ac:…]` markers in this file: `scripts/ac-coverage.mjs` walks
 * `src/` and `tests/` only, so a marker here would run green under `npm test`
 * and be invisible to coverage — the worst of both. The acceptance criteria live
 * in `tests/integration/`; what is pinned here is the SHAPE of the declaration,
 * which is this package's own business.
 */

import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { codeSnippetEntity } from '../src/entity/code-snippet/index.js';
import { codeSnippetCommands } from '../src/capabilities/commands.js';
import {
  CODE_SNIPPET_POPOVER_KIND,
  DEFAULT_LANGUAGE,
  LANGUAGE_ALIASES,
} from '../src/identity.js';

describe('envelope', () => {
  it('contributes exactly one entity and one command', () => {
    expect(manifest.contributes.entities).toHaveLength(1);
    expect(manifest.contributes.entities?.[0]).toBe(codeSnippetEntity);
    expect(manifest.contributes.commands).toHaveLength(1);
  });

  it('declares NO backend slot at all — not an empty one', () => {
    // An empty `backend: {}` would read as "a backend that happens to be empty"
    // and invites someone to fill it. The absence is the declaration.
    expect('backend' in codeSnippetEntity).toBe(false);
  });

  it('has a populated systemPrompt, without an MCP tools line', () => {
    expect(codeSnippetEntity.systemPrompt.roleNoun).toBe('Code snippets');
    expect(codeSnippetEntity.systemPrompt.narrativeBlock).toBeTruthy();
    expect(codeSnippetEntity.systemPrompt.mcpToolsLine).toBeUndefined();
    expect(codeSnippetEntity.systemPrompt.defaultPredicate).toBeUndefined();
  });

  it('suffixes slug collisions rather than refusing them', () => {
    // Two snippets sharing a title is ordinary, unlike two tools sharing a name.
    expect(codeSnippetEntity.slugConflict).toBe('suffix');
  });

  it('starts at payloadVersion 1 with an empty upgrade chain', () => {
    expect(codeSnippetEntity.payloadVersion).toBe(1);
    expect(codeSnippetEntity.payloadUpgrades).toBeUndefined();
  });

  it('declares the slash command only on the manifest', () => {
    expect(codeSnippetCommands[0]?.popoverKind).toBe(CODE_SNIPPET_POPOVER_KIND);
    expect(codeSnippetCommands[0]?.trigger).toBe('code-snippet');
  });
});

describe('data.schema', () => {
  const schema = codeSnippetEntity.data.schema as Record<string, Record<string, unknown>>;

  it('bounds EVERY field — an unbounded one would degrade the delta to opaque', () => {
    for (const name of ['title', 'language', 'filename', 'code']) {
      expect(schema[name]?.maxLength, `${name} must declare maxLength`).toBeTypeOf('number');
    }
  });

  it('flags NOTHING as contentBearing — code diffs as lines and stays searchable', () => {
    for (const node of Object.values(schema)) expect(node.contentBearing).toBeUndefined();
  });

  it('caps code at 10000 characters and requires it', () => {
    expect(schema.code?.maxLength).toBe(10000);
    expect(schema.code?.required).toBe(true);
  });

  it('carries no caption, description, highlightLines or ref field', () => {
    for (const absent of ['caption', 'description', 'highlightLines', 'ref']) {
      expect(schema[absent]).toBeUndefined();
    }
    // A snippet is a LEAF of the graph: it points at nothing.
    for (const node of Object.values(schema)) expect(node.ref).toBeUndefined();
  });
});

describe('the language alias table', () => {
  const aliases = LANGUAGE_ALIASES;

  it('is exactly the nine pairs the type promises', () => {
    expect(aliases).toEqual({
      '': DEFAULT_LANGUAGE,
      ts: 'typescript',
      js: 'javascript',
      py: 'python',
      sh: 'bash',
      shell: 'bash',
      zsh: 'bash',
      yml: 'yaml',
      md: 'markdown',
    });
  });

  it('has only folded keys — the lookup happens after folding', () => {
    for (const key of Object.keys(aliases)) expect(key).toBe(key.toLowerCase());
  });

  it('has no target that is itself a key — normalization must be idempotent', () => {
    for (const target of Object.values(aliases)) expect(aliases[target]).toBeUndefined();
  });

  it('is the SAME object the schema declares — one table, not two', () => {
    expect((codeSnippetEntity.data.schema.language as { normalize?: { aliases?: unknown } }).normalize?.aliases).toBe(
      aliases,
    );
  });
});
