/**
 * Manual verification for the M17 portable-bundle feature (brief 0.1.27→0.1.28).
 *
 * The repo has no test framework, so this standalone script exercises the pure
 * bundle logic against hand-built fixtures (no DB) and asserts every brief AC.
 *
 * Run after building the server:
 *   npm run build:server && node scripts/verify-bundle.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extract as tarExtract } from 'tar';

const here = path.dirname(fileURLToPath(import.meta.url));
const distMod = path.resolve(here, '..', 'dist', 'server', 'services', 'release-bundle.js');
if (!fs.existsSync(distMod)) {
  console.error(`\nMissing ${distMod}\nRun \`npm run build:server\` first.\n`);
  process.exit(1);
}
const { buildBundleArchive, sanitizeConfigForBundle } = await import(distMod);

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const cleanup = [];
const extractTo = async (tarGzPath) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-verify-'));
  cleanup.push(dir);
  await tarExtract({ file: tarGzPath, cwd: dir });
  return dir;
};

// ── Fixtures ────────────────────────────────────────────────────────────────
const release = {
  id: 7,
  name: 'test-rel',
  description: 'a test release',
  createdBy: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const snapshot = {
  release,
  serializer_versions: {
    endpoint: '1.4.0',
    dto: '2.1.0',
    'database-table': '1.0.0',
    'ui-view': '1.0.0',
    ac: '1.0.0',
    page: '1.1.0',
  },
  entities: [
    { type: 'endpoint', slug: 'get-user', op: 'create', data: { slug: 'get-user', method: 'GET' } },
    { type: 'endpoint', slug: 'gone-ep', op: 'delete', data: { slug: 'gone-ep' } }, // tombstone → excluded
    { type: 'dto', slug: 'user-dto', op: 'update', data: { slug: 'user-dto', fields: [] } },
    // no ac / database-table / ui-view rows → those files must NOT be emitted
  ],
  pages: [
    { path: 'index.md', op: 'create', data: { path: 'index.md', content: '# Index\n', frontmatter: {}, anchors: [], xml_refs: [] } },
    { path: 'modules/m17.md', op: 'update', data: { path: 'modules/m17.md', content: '# M17\n\nbody line\n', frontmatter: {}, anchors: [], xml_refs: [] } },
    { path: 'deleted.md', op: 'delete', data: { path: 'deleted.md', content: 'gone', frontmatter: {}, anchors: [], xml_refs: [] } }, // tombstone → excluded
  ],
};
const config = {
  $schemaVersion: 2,
  name: 'My Project',
  port: 4500,
  pagesDir: 'pages',
  briefsDir: '.claude4spec/briefs',
  patchesDir: '.claude4spec/patches',
  mode: 'dev',
  writingStyle: 'layered-vertical-slices',
  onboardingCompleted: true,
  entities: ['endpoint', 'dto'],
  consistency: { requireAcCoverage: 'warn' },
  agent: { claudeUsePreset: true },
  remoteApiUrl: 'http://localhost:3000',
};

// ── Build + extract ───────────────────────────────────────────────────────
console.log('\nbuildBundleArchive — populated release');
const result = await buildBundleArchive(snapshot, release, config);
cleanup.push(result.tarGzPath);
const dir = await extractTo(result.tarGzPath);

// Result shape + SHA round-trip
check('result.bundleSchemaVersion === 1', result.bundleSchemaVersion === 1);
check('tarGzPath exists on disk', fs.existsSync(result.tarGzPath));
check('sizeBytes matches file', result.sizeBytes === fs.statSync(result.tarGzPath).size);
const expectedSha = createHash('sha256').update(fs.readFileSync(result.tarGzPath)).digest('hex');
check('sha256 round-trips final file', result.sha256 === expectedSha, `${result.sha256} vs ${expectedSha}`);
check('sha256 is lowercase hex64', /^[0-9a-f]{64}$/.test(result.sha256));

// No DB / no post-release artifacts
console.log('absence invariants');
for (const forbidden of ['db.sqlite', 'db.sqlite-wal', 'db.sqlite-shm', 'briefs', 'patches', 'skills', 'mcp.json', '.git']) {
  check(`bundle has no ${forbidden}`, !fs.existsSync(path.join(dir, forbidden)));
}
const topLevel = fs.readdirSync(dir).sort();
check('top level === manifest/config/entities/pages', JSON.stringify(topLevel) === JSON.stringify(['config.json', 'entities', 'manifest.json', 'pages']), topLevel.join(','));

// config.json whitelist
console.log('config.json whitelist');
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
const cfgKeys = Object.keys(cfg).sort();
const expectedKeys = ['$schemaVersion', 'agent', 'entities', 'mode', 'name', 'onboardingCompleted', 'pagesDir', 'writingStyle'].sort();
check('config keys === whitelist', JSON.stringify(cfgKeys) === JSON.stringify(expectedKeys), cfgKeys.join(','));
for (const dropped of ['port', 'briefsDir', 'patchesDir', 'remoteApiUrl', 'consistency']) {
  check(`config drops ${dropped}`, !(dropped in cfg));
}
check('config.agent.claudeUsePreset preserved', cfg.agent && cfg.agent.claudeUsePreset === true);

// manifest.json shape
console.log('manifest.json shape');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
check('bundleSchemaVersion === 1', manifest.bundleSchemaVersion === 1);
check('release.id/name/description/createdAt match', manifest.release.id === 7 && manifest.release.name === 'test-rel' && manifest.release.description === 'a test release' && manifest.release.createdAt === release.createdAt);
check('c4sVersion is non-empty string', typeof manifest.c4sVersion === 'string' && manifest.c4sVersion.length > 0);
check('manifest.createdAt is ISO and > release.createdAt', !Number.isNaN(Date.parse(manifest.createdAt)) && Date.parse(manifest.createdAt) > Date.parse(release.createdAt));
check('serializerVersions preserved per type', manifest.serializerVersions && manifest.serializerVersions.endpoint === '1.4.0' && manifest.serializerVersions.dto === '2.1.0');

// pages byte-equal + filtering
console.log('pages/');
check('pages/index.md byte-equal', fs.readFileSync(path.join(dir, 'pages', 'index.md'), 'utf8') === '# Index\n');
check('pages/modules/m17.md byte-equal (nested)', fs.readFileSync(path.join(dir, 'pages', 'modules', 'm17.md'), 'utf8') === '# M17\n\nbody line\n');
check('deleted page excluded', !fs.existsSync(path.join(dir, 'pages', 'deleted.md')));

// entities per active type
console.log('entities/');
const endpoints = JSON.parse(fs.readFileSync(path.join(dir, 'entities', 'endpoints.json'), 'utf8'));
check('endpoints.json is array, tombstone excluded (len 1)', Array.isArray(endpoints) && endpoints.length === 1 && endpoints[0].slug === 'get-user');
const dtos = JSON.parse(fs.readFileSync(path.join(dir, 'entities', 'dtos.json'), 'utf8'));
check('dtos.json is array (len 1)', Array.isArray(dtos) && dtos.length === 1 && dtos[0].slug === 'user-dto');
for (const absent of ['acs.json', 'database-tables.json', 'ui-views.json']) {
  check(`entities/${absent} NOT created (no rows)`, !fs.existsSync(path.join(dir, 'entities', absent)));
}

// temp working dir cleaned up (only the .tar.gz file may remain, no c4s-bundle-* dirs)
console.log('temp cleanup');
const leftoverDirs = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('c4s-bundle-') && fs.statSync(path.join(os.tmpdir(), n)).isDirectory());
check('no leftover c4s-bundle-* working dirs', leftoverDirs.length === 0, leftoverDirs.join(','));

// sanitize is pure white-list (direct call)
console.log('sanitizeConfigForBundle direct');
const sanitized = sanitizeConfigForBundle(config);
check('sanitize drops non-whitelisted', !('port' in sanitized) && !('remoteApiUrl' in sanitized) && !('consistency' in sanitized));

// ── Empty release ───────────────────────────────────────────────────────────
console.log('buildBundleArchive — empty release');
const emptySnapshot = { release, serializer_versions: { page: '1.1.0' }, entities: [], pages: [] };
let emptyResult;
let threw = false;
try {
  emptyResult = await buildBundleArchive(emptySnapshot, release, config);
  cleanup.push(emptyResult.tarGzPath);
} catch {
  threw = true;
}
check('empty release does not throw', !threw);
if (emptyResult) {
  const edir = await extractTo(emptyResult.tarGzPath);
  check('empty bundle has manifest.json + config.json', fs.existsSync(path.join(edir, 'manifest.json')) && fs.existsSync(path.join(edir, 'config.json')));
  check('empty bundle has no pages/ dir', !fs.existsSync(path.join(edir, 'pages')));
  check('empty bundle has no entities/ dir', !fs.existsSync(path.join(edir, 'entities')));
}

// ── restoreBundleArchive stub ─────────────────────────────────────────────
console.log('restoreBundleArchive stub');
try {
  const { ReleaseService } = await import(path.resolve(here, '..', 'dist', 'server', 'services', 'release.js'));
  const rs = new ReleaseService(null, null, null, null, null, null, null, null, null);
  let stubErr = null;
  try {
    await rs.restoreBundleArchive(null);
  } catch (e) {
    stubErr = e;
  }
  check('restoreBundleArchive throws', stubErr instanceof Error);
  check('message mentions NOT_IMPLEMENTED + M26', !!stubErr && stubErr.message.includes('NOT_IMPLEMENTED') && stubErr.message.includes('M26'), stubErr ? stubErr.message : 'no error');
} catch (e) {
  check('restore stub verifiable (import release.js)', false, String(e));
}

// ── Cleanup + exit ───────────────────────────────────────────────────────────
for (const p of cleanup) fs.rmSync(p, { recursive: true, force: true });

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
