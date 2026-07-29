/**
 * Host lookups must be METHOD calls.
 *
 * `clientPluginHost.getAvailable` reads `this.modules`. Pulling it into a local
 * to write a cast once — which is the natural thing to do while the published
 * surface types it loosely — unbinds the receiver, and the component then throws
 * "Cannot read properties of undefined (reading 'modules')" the first time it
 * renders. It type-checks either way, so nothing catches it before a browser
 * does; that is exactly how it reached a running environment during this change.
 *
 * There is no DOM environment in this suite, so the guard is on the source: no
 * file may bind a host lookup to a variable. Crude, but it fails for the right
 * reason and it is falsifiable — reinstate the local and this goes red.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(import.meta.dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(abs) : /\.tsx?$/.test(e.name) ? [abs] : [];
  });
}

describe('clientPluginHost lookups', () => {
  it('are never bound to a variable before being called', () => {
    // `const x = clientPluginHost.getAvailable` — with or without a cast.
    const unbound = /=\s*clientPluginHost\.\w+\s*(?:as\b|;|\n)/;
    // `(clientPluginHost.getAvailable as T)(…)` — casting the function then
    // calling the result loses `this` just the same.
    const castThenCall = /\(\s*clientPluginHost\.\w+\s+as\b[\s\S]{0,120}?\)\s*\(/;

    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf-8');
      if (unbound.test(text) || castThenCall.test(text)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
