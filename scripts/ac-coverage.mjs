#!/usr/bin/env node
// AC test-coverage report: compares the spec's AC list (via c4s) against
// `[ac:<slug>]` markers in test titles and the skiplist of non-automatable
// ACs. The marker carries the full slug — AC slugs are NOT uniformly
// `ac-`-prefixed (24 of 253 start with `m06-`/`m11-`/... instead).
//
// Usage: node scripts/ac-coverage.mjs [--uncovered-only]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = path.join(ROOT, '.claude/skills/specyfikacja');
const SKIPLIST_PATH = path.join(ROOT, 'tests/ac-skiplist.json');

function specAcSlugs() {
  const out = execFileSync(
    'npx',
    ['tsx', 'src/bin/c4s.ts', 'list-slugs', '--type', 'ac', '--project', SPEC_DIR, '--format', 'json', '--compact'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const parsed = JSON.parse(out);
  if (parsed.error) {
    console.error(`c4s error: ${parsed.error.code} — ${parsed.error.message}`);
    process.exit(1);
  }
  return parsed.slugs;
}

function* walkTestFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walkTestFiles(full);
    } else if (entry.name.endsWith('.test.ts')) {
      yield full;
    }
  }
}

function coveredSlugs() {
  const covered = new Map(); // slug -> [files]
  for (const base of ['src', 'tests']) {
    for (const file of walkTestFiles(path.join(ROOT, base))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\[ac:([a-z0-9-]+)\]/g)) {
        const slug = match[1];
        const files = covered.get(slug) ?? [];
        if (!files.includes(file)) files.push(file);
        covered.set(slug, files);
      }
    }
  }
  return covered;
}

function skiplist() {
  if (!fs.existsSync(SKIPLIST_PATH)) return {};
  return JSON.parse(fs.readFileSync(SKIPLIST_PATH, 'utf8'));
}

const uncoveredOnly = process.argv.includes('--uncovered-only');
const spec = specAcSlugs();
const covered = coveredSlugs();
const skipped = skiplist();

const specSet = new Set(spec);
const problems = [];
for (const slug of covered.keys()) {
  if (!specSet.has(slug)) problems.push(`unknown slug in tests (not in spec): ${slug}`);
  if (slug in skipped) problems.push(`slug both covered and skiplisted: ${slug}`);
}
for (const slug of Object.keys(skipped)) {
  if (!specSet.has(slug)) problems.push(`unknown slug in skiplist (not in spec): ${slug}`);
  if (!skipped[slug] || typeof skipped[slug] !== 'string') {
    problems.push(`skiplist entry without a reason: ${slug}`);
  }
}

const uncovered = spec.filter((slug) => !covered.has(slug) && !(slug in skipped));

if (!uncoveredOnly) {
  console.log(`AC total:     ${spec.length}`);
  console.log(`covered:      ${covered.size}`);
  console.log(`skipped:      ${Object.keys(skipped).length}`);
  console.log(`uncovered:    ${uncovered.length}`);
  console.log('');
}
for (const slug of uncovered) console.log(`uncovered: ${slug}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`PROBLEM: ${p}`);
  process.exit(2);
}
