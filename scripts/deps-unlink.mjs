#!/usr/bin/env node
// Switch @inharness-ai/* dependencies from local file:.. back to registry (^x.y.z).
// Run this before committing or publishing. Reads versions from sibling repos' package.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const mapping = {
  '@inharness-ai/agent-adapters': '../agent-adapters',
  '@inharness-ai/agent-chat': '../agent-chat',
};

let changed = 0;
for (const [name, siblingPath] of Object.entries(mapping)) {
  const current = pkg.dependencies?.[name];
  if (!current || !current.startsWith('file:')) continue;

  const siblingPkgPath = resolve(here, '..', siblingPath, 'package.json');
  if (!existsSync(siblingPkgPath)) {
    console.error(`Sibling repo not found at ${siblingPkgPath}; cannot determine version for ${name}.`);
    process.exit(1);
  }
  const siblingPkg = JSON.parse(readFileSync(siblingPkgPath, 'utf8'));
  const version = `^${siblingPkg.version}`;
  pkg.dependencies[name] = version;
  changed++;
  console.log(`${name}: file:.. -> ${version}`);
}

if (changed === 0) {
  console.log('Already on registry versions — no changes.');
  process.exit(0);
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\nUnlinked ${changed} dependencies. Running npm install...`);
execSync('npm install', { stdio: 'inherit', cwd: dirname(pkgPath) });
