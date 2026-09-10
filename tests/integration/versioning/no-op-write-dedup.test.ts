import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { fixtureModule } from '../../helpers/fixture-module.js';
import { PLAN_ROOT_MARKER } from '../../../src/shared/types.js';

/**
 * 0.2.79 — "mutation" means a change of CONTENT. A write of identical content
 * makes no entry in the version log.
 *
 * Both axes, one rule, and they are entirely separate code paths: entity
 * mutations land in `entity_version` through `VersionService.captureEntitySnapshot`,
 * page writes land in `file_version` through `FileVersionService.recordVersion`.
 * Each is asserted here against the door a caller actually uses, not against the
 * private comparison inside it.
 *
 * What is NOT weakened: "1 mutation = 1 row". Nothing is aggregated and no two
 * genuinely different writes are merged — only the byte-identical write is
 * suppressed. Each test therefore ends by making a REAL change and watching the
 * log grow again, because "the log stopped growing" and "the log is broken" look
 * the same from a single assertion.
 *
 * The record-write primitive (M42) is deliberately untouched by all of this: its
 * chain runs unconditionally, and the dedup belongs to the capture phase, which
 * already reads the content it would compare.
 */
const widget = fixtureModule('widget', { withEntityService: true });

describe('a write that changes no content writes no version row', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp({ extraModules: [widget] });
  });

  afterEach(() => t.cleanup());

  it('[ac:ac-mutacja-encji-wartosciami-identycznym] a mutation with values identical to the current ones adds no entity_version row', async () => {
    const { slug } = await t.crud.create('widget', { title: 'Reporting widget' }, 'user');
    const before = t.versionService.listVersions('widget', slug);
    expect(before.length).toBeGreaterThan(0);

    // The same values the entity already holds — a write, not a skipped call:
    // the whole chain below `capture` runs, and only the INSERT is withheld.
    await t.crud.update('widget', slug, { title: 'Reporting widget' }, 'user');

    const after = t.versionService.listVersions('widget', slug);
    expect(after).toHaveLength(before.length);

    // ...and a real change still records, so the log is suppressed, not stuck.
    await t.crud.update('widget', slug, { title: 'Reporting widget v2' }, 'user');
    expect(t.versionService.listVersions('widget', slug)).toHaveLength(before.length + 1);
  });

  /**
   * The `changed_by` axis of the same rule: `user`, `agent` and `filesystem` are
   * all one kind of write here. Stated as its own case because the entity axis
   * threads an actor through every call, so "did it only dedup for `user`" is a
   * question a single-actor test cannot answer.
   */
  it('suppresses the identical mutation regardless of the actor', async () => {
    const { slug } = await t.crud.create('widget', { title: 'Actor widget' }, 'user');
    const before = t.versionService.listVersions('widget', slug).length;

    await t.crud.update('widget', slug, { title: 'Actor widget' }, 'agent');
    await t.crud.update('widget', slug, { title: 'Actor widget' }, 'user');

    expect(t.versionService.listVersions('widget', slug)).toHaveLength(before);
  });

  it('[ac:ac-zapis-strony-trescia-identyczna-z-ost] a page write with content identical to the last version adds no file_version row', async () => {
    const relPath = 'no-op-page.md';
    const abs = path.join(t.plansPages.root, relPath);
    const content = '# No-op page\n\nSome body text.\n';
    fs.writeFileSync(abs, content, 'utf-8');

    await t.pageVersions.recordVersion(relPath, 'create', 'user', undefined, t.plansSerializer, PLAN_ROOT_MARKER);
    const before = t.pageVersions.listVersions(relPath, PLAN_ROOT_MARKER);
    expect(before.length).toBeGreaterThan(0);

    // Rewrite the SAME bytes and capture again — no new version.
    fs.writeFileSync(abs, content, 'utf-8');
    await t.pageVersions.recordVersion(relPath, 'update', 'user', undefined, t.plansSerializer, PLAN_ROOT_MARKER);

    const after = t.pageVersions.listVersions(relPath, PLAN_ROOT_MARKER);
    expect(after).toHaveLength(before.length);

    // A real edit still records.
    fs.writeFileSync(abs, content + '\nAnd a new line.\n', 'utf-8');
    await t.pageVersions.recordVersion(relPath, 'update', 'user', undefined, t.plansSerializer, PLAN_ROOT_MARKER);
    expect(t.pageVersions.listVersions(relPath, PLAN_ROOT_MARKER)).toHaveLength(before.length + 1);
  });

  /**
   * The tombstone is the one predecessor that must never suppress a write.
   *
   * A `delete` row stores the FULL last-known snapshot, so an entity or a page
   * recreated with its pre-delete content compares equal to it. Withholding that
   * row would leave the log's head reading `delete` for something that exists —
   * and every consumer of the head reads that as "gone": release restore would
   * delete the live file, and `countUnreleased` would see nothing to release.
   * Resurrection is a genuine change of state, so it always records.
   */
  it('records a row when a deleted page is recreated with its pre-delete content', async () => {
    const relPath = 'resurrected-page.md';
    const abs = path.join(t.plansPages.root, relPath);
    const content = '# Resurrected\n\nOriginal body.\n';

    fs.writeFileSync(abs, content, 'utf-8');
    await t.pageVersions.recordVersion(relPath, 'create', 'user', undefined, t.plansSerializer, PLAN_ROOT_MARKER);
    fs.rmSync(abs);
    await t.pageVersions.recordVersion(relPath, 'delete', 'user', undefined, t.plansSerializer, PLAN_ROOT_MARKER);
    const afterDelete = t.pageVersions.listVersions(relPath, PLAN_ROOT_MARKER).length;

    // The path was captured once, so the capture service classifies this as an
    // `update` — there is no second `create` for a path the log has ever seen.
    fs.writeFileSync(abs, content, 'utf-8');
    await t.pageVersions.recordVersion(relPath, 'update', 'user', undefined, t.plansSerializer, PLAN_ROOT_MARKER);

    expect(t.pageVersions.listVersions(relPath, PLAN_ROOT_MARKER)).toHaveLength(afterDelete + 1);
    expect(t.pageVersions.getLatestForPath(relPath, undefined, PLAN_ROOT_MARKER)?.op).toBe('update');
  });

  it('records a row when an entity is renamed back onto a deleted slug', async () => {
    const { slug } = await t.crud.create('widget', { title: 'Ghost' }, 'user');
    await t.crud.delete('widget', slug, 'user');
    const afterDelete = t.versionService.listVersions('widget', slug).length;

    // A rename onto the freed slug captures an `update` AT THAT SLUG, and its
    // declared values are the deleted entity's — `diffEntity` ignores the slug,
    // so the snapshot diffs `noop` against the tombstone and only the op guard
    // keeps the row.
    const other = await t.crud.create('widget', { title: 'Other' }, 'user');
    await t.crud.update('widget', other.slug, { title: 'Ghost', newSlug: slug }, 'user');

    const log = t.versionService.listVersions('widget', slug);
    expect(log.length).toBeGreaterThan(afterDelete);
    expect(log[0]!.op).not.toBe('delete');
  });

  /**
   * Rollback is unaffected, and that is the claim worth pinning: a state the log
   * skipped is byte-identical to one already in it, so every intermediate state
   * remains reachable. Restoring to the version that survived the suppressed
   * write returns exactly the content the suppressed write would have stored.
   */
  it('leaves every intermediate state restorable after a suppressed write', async () => {
    const { slug } = await t.crud.create('widget', { title: 'Restorable' }, 'user');
    await t.crud.update('widget', slug, { title: 'Restorable' }, 'user');

    const versions = t.versionService.listVersions('widget', slug);
    const latest = versions[0];
    expect(latest).toBeDefined();

    const detail = t.versionService.getVersion('widget', slug, latest!.version);
    expect((detail?.data as { title?: string } | null)?.title).toBe('Restorable');
  });
});
