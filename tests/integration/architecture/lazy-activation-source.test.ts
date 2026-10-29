/**
 * 2.1.58 — M29 `m29idx001` / `m29krit1`, M31 `m31ctx001`: no project is built
 * before `app.listen()`; `indexAll()` is awaited inside the context build, and
 * the context build runs only through the cache — 2.1.60: its background build
 * queue, started right after the listen.
 *
 * The behaviour is pinned by `src/server/workspace/lazy-activation.test.ts`
 * (the cache's `activatingBuild` activates on the first request, a broken project
 * answers PROJECT_BUILD_FAILED, the start prepares no project). These are the
 * SOURCE halves: the start path (`prepareStart`, `startServer` up to the listen)
 * holds no activation, no build and no cache read, and the build awaits the
 * entity index.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const SERVER_INDEX = path.join(REPO_ROOT, 'src', 'server', 'index.ts');
const LAUNCH = path.join(REPO_ROOT, 'src', 'bin', 'launch.ts');
const PROJECT_CONTEXT = path.join(REPO_ROOT, 'src', 'server', 'workspace', 'project-context.ts');

/** Code lines only — comment lines describe the patterns, they do not use them. */
function codeLines(file: string): Array<{ line: number; text: string }> {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => {
      const t = text.trim();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    });
}

/** A context read, an activation, a build or the start of the build queue — none may run before the listen. */
const FORBIDDEN_BEFORE_LISTEN =
  /^(?:cache\.(?:get|getLive|start|enqueue)|buildContext|buildProjectContext|activateProject|activateProjectDir|bootstrapProject|activatingBuild\([\s\S]*\)|backgroundBuild\([\s\S]*\)|loadOrCreateConfig|.*\.indexAll)$/;

/** Array methods that invoke their callback before they return. */
const SYNC_CALLBACK_METHODS = new Set(['forEach', 'map', 'flatMap', 'filter', 'some', 'every', 'find', 'findIndex', 'reduce']);

/**
 * The callees of every call `fn` EXECUTES before its `await listenOrExit(...)`
 * statement — read off the AST, not off the text. A function body (arrow,
 * function expression, method) is a deferred closure and is skipped, unless it
 * is invoked on the way: an IIFE, a callback of a synchronous array method, or
 * a local function of `fn` called by name (its body is then walked once).
 */
function eagerCallsBeforeListen(file: string, fn: string): string[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const decl = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn);
  if (!decl?.body) throw new Error(`function ${fn} not found in ${file}`);
  const statements = decl.body.statements;

  const callsListen = (node: ts.Node): boolean =>
    (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'listenOrExit') ||
    (ts.forEachChild(node, (child) => (callsListen(child) ? true : undefined)) ?? false);
  const listenAt = statements.findIndex(callsListen);
  if (listenAt < 0) throw new Error(`${fn} has no listenOrExit call`);

  // Local functions of `fn` (`const x = () => …`, `function x() …`).
  const locals = new Map<string, ts.Node>();
  for (const s of statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) locals.set(s.name.text, s.body);
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      const init = d.initializer;
      if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        locals.set(d.name.text, init.body);
      }
    }
  }

  const callees: string[] = [];
  const walkedLocals = new Set<string>();
  const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e);
  const walkBody = (fnNode: ts.Node): void => {
    if (ts.isArrowFunction(fnNode) || ts.isFunctionExpression(fnNode)) walk(fnNode.body);
  };
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return; // a deferred closure
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      callees.push(callee.getText(sf));
      // An IIFE runs now.
      walkBody(callee);
      // A synchronous array method runs its callback now.
      if (ts.isPropertyAccessExpression(callee) && SYNC_CALLBACK_METHODS.has(callee.name.text)) {
        for (const arg of node.arguments) walkBody(unwrap(arg));
      }
      // A local function called by name runs now.
      if (ts.isIdentifier(callee) && locals.has(callee.text) && !walkedLocals.has(callee.text)) {
        walkedLocals.add(callee.text);
        walk(locals.get(callee.text)!);
      }
    }
    ts.forEachChild(node, walk);
  };
  for (const s of statements.slice(0, listenAt)) walk(s);
  return callees;
}

describe('2.1.58 — no project is built before listen (source)', () => {
  it('[section:m29idx001] [section:m29krit1] the context build awaits entityIndexer.indexAll() — for every project, the one place a project gets its index', () => {
    const lines = codeLines(PROJECT_CONTEXT);
    // 2.1.60: the background build passes `{ persistUpgrades: false }` — still awaited, every build.
    expect(lines.some(({ text }) => /\bawait entityIndexer\.indexAll\s*\(/.test(text))).toBe(true);
    // The build is one function for every project: no "start project" branch in it.
    expect(lines.filter(({ text }) => /initialProject|isInitial|pagesDirOverride/.test(text))).toEqual([]);
  });

  it('[section:m31ctx001] [section:m29idx001] [section:r7ozfsa9] [ac:ac-serwer-przyjmuje-zadania-zanim-zbuduj] startServer builds no context before listenOrExit; the background build queue starts right after it, its builds through backgroundBuild and activatingBuild', () => {
    const eager = eagerCallsBeforeListen(SERVER_INDEX, 'startServer');
    // The walk sees the start path: the plugin pool is loaded there (a sanity
    // check that the statements before the listen were reached at all).
    expect(eager).toContain('loadWorkspacePlugins');
    // No warm-up read of the cache, no queue start, no activation and no build
    // executed on the start path. A closure (the cache's builders, its
    // `providerContext`, a router callback) runs later, not here — it is not
    // walked unless something before the listen invokes it.
    expect(eager.filter((callee) => FORBIDDEN_BEFORE_LISTEN.test(callee))).toEqual([]);
    const lines = codeLines(SERVER_INDEX);
    expect(lines.filter(({ text }) => /\binitialProject\b|\bwritingStyle:\s*initialCtx/.test(text))).toEqual([]);
    // The one build site is the cache's: the build with writes wrapped by the
    // activation, the background build without writes.
    const builds = lines.filter(({ text }) => /\bbuildProjectContext\s*\(/.test(text));
    expect(builds).toHaveLength(1);
    // Both carry the build's abort signal (a disposed/retired build ends early).
    expect(
      lines.some(({ text }) =>
        /activatingBuild\(registry, workspace, \(project, signal\) => buildContext\(project, 'allowed', signal\), activated\)/.test(text),
      ),
    ).toBe(true);
    expect(
      lines.some(({ text }) =>
        /background: backgroundBuild\(registry, \(project, mode\) => buildContext\(project, mode\.projectWrites, mode\.signal\)\)/.test(text),
      ),
    ).toBe(true);
    // The queue gets the composition only AFTER the listen — last opened project first.
    const listenAt = lines.find(({ text }) => /await listenOrExit\(/.test(text))!.line;
    const startAt = lines.filter(({ text }) => /\bcache\.start\(/.test(text));
    expect(startAt).toHaveLength(1);
    expect(startAt[0]!.line).toBeGreaterThan(listenAt);
    expect(startAt[0]!.text).toMatch(/cache\.start\(startView\.projects, startView\.lastOpenedProject\)/);
  });

  it('[section:m29krit1] the launcher\'s pre-listen sequence activates and builds nothing', () => {
    const lines = codeLines(LAUNCH);
    expect(
      lines.filter(({ text }) => /\b(activateProject|activateProjectDir|bootstrapProject|buildProjectContext|loadOrCreateConfig|migrateConfigToV3)\b/.test(text)),
    ).toEqual([]);
  });
});
