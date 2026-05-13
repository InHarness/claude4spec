#!/usr/bin/env node
// Switch @inharness-ai/* dependencies from registry (^x.y.z) to local file:..
// Use during development to pick up live changes from sibling repos.
// Do NOT commit the resulting package.json. Run `npm run deps:unlink` before commit.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const overrides = {
  '@inharness-ai/agent-adapters': 'file:../agent-adapters',
  '@inharness-ai/agent-chat': 'file:../agent-chat',
};

let changed = 0;
for (const [name, value] of Object.entries(overrides)) {
  if (pkg.dependencies?.[name] && pkg.dependencies[name] !== value) {
    pkg.dependencies[name] = value;
    changed++;
  }
}

if (changed === 0) {
  console.log('Already linked to local file:.. — no changes.');
  process.exit(0);
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Linked ${changed} dependencies to local file:..`);
console.log('Running npm install...');
execSync('npm install', { stdio: 'inherit', cwd: dirname(pkgPath) });
console.log('\nREMINDER: run `npm run deps:unlink` before committing.');
