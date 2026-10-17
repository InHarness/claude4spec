/**
 * The shipped type on a host running in this process: the generated REST doors
 * enforce the classification (`l12slice0` — a record without `stability` or
 * `binding` is not created), the slug comes from `name`, and the audit is
 * reachable through the host's generic tool proxy
 * (`POST /api/entities/:type/tools/:tool`, c4s-plugin-host-ui-kit-components
 * `6o1rfh21`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPluginTestApp, type PluginTestApp } from '@c4s-internal/plugin-test-setup';
import { manifest } from '../src/manifest.js';

const VALID = {
  name: 'TagFilterBar',
  group: 'list',
  stability: 'experimental',
  binding: 'presentational',
  props: [{ name: 'tags', type: 'Tag[]', required: true }],
};

describe('ui-kit-component — the shipped type', () => {
  let t: PluginTestApp;

  beforeEach(async () => {
    t = await createPluginTestApp([manifest]);
  });
  afterEach(() => t.cleanup());

  const post = (body: Record<string, unknown>) => request(t.app).post(`${t.baseUrl}/ui-kit-components`).send(body);
  const audit = (body: Record<string, unknown> = {}) =>
    request(t.app).post(`${t.baseUrl}/entities/ui-kit-component/tools/audit_ui_kit_components`).send(body);

  it('[entity:encje-pluginy#c4s-plugin-host-ui-kit-components] is registered from the package manifest and active', () => {
    expect(t.host.listEntities().map((m) => m.type)).toContain('ui-kit-component');
  });

  it('[section:spf7qirh] the slug is name in kebab-case and title defaults to name', async () => {
    const res = await post(VALID);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ slug: 'tag-filter-bar', name: 'TagFilterBar', title: 'TagFilterBar' });
  });

  it('[ac:ac-kazdy-wpis-katalogu-host-ui-kit-deklaruj] a record without binding, or with a binding outside presentational | connected, is not created', async () => {
    const { binding: _omit, ...withoutBinding } = VALID;
    const missing = await post(withoutBinding);
    expect(missing.status).toBe(400);
    const wrong = await post({ ...VALID, binding: 'hybrid' });
    expect(wrong.status).toBe(400);
    // Nothing was created by either refusal.
    const list = await request(t.app).get(`${t.baseUrl}/ui-kit-components`);
    expect(list.body.data).toEqual([]);
    // The same body WITH a binding is created, carrying it.
    for (const binding of ['presentational', 'connected']) {
      const ok = await post({ ...VALID, name: `Comp${binding}`, binding });
      expect(ok.status).toBe(201);
      expect(ok.body.data.binding).toBe(binding);
    }
  });

  it('[section:l12slice0] a record without stability is not created either', async () => {
    const { stability: _omit, ...withoutStability } = VALID;
    expect((await post(withoutStability)).status).toBe(400);
  });

  it('[ac:ac-komponent-o-binding-connected-jawni] the audit reports a connected record that names no fetchedByComponent dataSources entry, and passes one that does', async () => {
    expect(
      (await post({ ...VALID, name: 'HistoryView', binding: 'connected', dataSources: [{ export: 'useVersions', usage: 'fetchedByComponent' }] })).status,
    ).toBe(201);
    expect(
      (await post({ ...VALID, name: 'SilentView', binding: 'connected', dataSources: [{ export: 'useTags', usage: 'feedsProps' }] })).status,
    ).toBe(201);

    const res = await audit({ rules: ['connected-without-fetch'] });
    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body.content[0].text) as { checked: number; violations: Array<{ rule: string; slugs: string[] }> };
    expect(payload.checked).toBe(2);
    expect(payload.violations.map((v) => [v.rule, v.slugs])).toEqual([['connected-without-fetch', ['silent-view']]]);
  });

  it('[section:6o1rfh21] the audit refuses an unknown slug or rule through the proxy, with no partial result', async () => {
    expect((await audit({ slugs: ['nope'] })).status).toBe(404);
    expect((await audit({ rules: ['no-such-rule'] })).status).toBe(400);
  });
});
