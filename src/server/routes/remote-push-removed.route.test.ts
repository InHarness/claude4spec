import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPluginTestApp, type PluginTestApp } from '../../../tests/helpers/plugin-test-setup.js';

/**
 * 2.1.55 — M25 Release Push is gone. Its five local routes (`/api/release-pushes`,
 * `/api/release-pushes/:id`, `/api/remote-project` GET/PATCH) are no longer
 * mounted on the project router, so none of their payloads (the push request /
 * response / list, the remote-project info and edit body) is served any more.
 *
 * Proven on a real project context (`buildProjectContext`, the router the server
 * mounts under `/api/projects/<id>`). The remote account (M24) stays: its route
 * still answers, which is the control that the router itself is up.
 */
describe('M25 release push routes are no longer served (2.1.55)', () => {
  let t: PluginTestApp;

  beforeAll(async () => {
    t = await createPluginTestApp([]);
  }, 60_000);

  afterAll(async () => {
    await t?.cleanup();
  });

  it('control: the project router is up — GET /api/remote-account (M24) still answers 200', async () => {
    const res = await request(t.app).get(`${t.baseUrl}/remote-account`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('[entity:post-api-release-pushes] POST /api/release-pushes is no longer served (404)', async () => {
    const res = await request(t.app).post(`${t.baseUrl}/release-pushes`).send({ releaseName: 'v1' });
    expect(res.status).toBe(404);
  });

  it('[entity:get-api-release-pushes] GET /api/release-pushes is no longer served (404), with or without ?releaseName', async () => {
    expect((await request(t.app).get(`${t.baseUrl}/release-pushes`)).status).toBe(404);
    expect((await request(t.app).get(`${t.baseUrl}/release-pushes?releaseName=v1`)).status).toBe(404);
  });

  it('[entity:get-api-release-pushes-id] GET /api/release-pushes/:id is no longer served (404)', async () => {
    const res = await request(t.app).get(`${t.baseUrl}/release-pushes/1`);
    expect(res.status).toBe(404);
  });

  it('[entity:get-api-remote-project] GET /api/remote-project is no longer served (404)', async () => {
    const res = await request(t.app).get(`${t.baseUrl}/remote-project`);
    expect(res.status).toBe(404);
  });

  it('[entity:patch-api-remote-project] PATCH /api/remote-project is no longer served (404)', async () => {
    const res = await request(t.app).patch(`${t.baseUrl}/remote-project`).send({ name: 'Renamed' });
    expect(res.status).toBe(404);
  });

  it('[entity:release-push-request] no route accepts the ReleasePushRequest body { releaseName } any more', async () => {
    const res = await request(t.app).post(`${t.baseUrl}/release-pushes`).send({ releaseName: 'v1' });
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('releaseId');
  });

  it('[entity:release-push-response] no route answers a ReleasePushResponse any more — neither the push nor the single-entry read', async () => {
    for (const res of [
      await request(t.app).post(`${t.baseUrl}/release-pushes`).send({ releaseName: 'v1' }),
      await request(t.app).get(`${t.baseUrl}/release-pushes/1`),
    ]) {
      expect(res.status).toBe(404);
      for (const k of ['contentSha256', 'remoteReleaseId', 'pushedAt', 'gitSync']) expect(res.body).not.toHaveProperty(k);
    }
  });

  it('[entity:release-push-list-response] no route answers a ReleasePushListResponse { items } any more', async () => {
    const res = await request(t.app).get(`${t.baseUrl}/release-pushes`);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('items');
  });

  it('[entity:remote-project-info] no route answers a RemoteProjectInfo { linked, fetched, isOwner } any more', async () => {
    for (const res of [
      await request(t.app).get(`${t.baseUrl}/remote-project`),
      await request(t.app).patch(`${t.baseUrl}/remote-project`).send({ description: null }),
    ]) {
      expect(res.status).toBe(404);
      for (const k of ['linked', 'fetched', 'isOwner', 'project']) expect(res.body).not.toHaveProperty(k);
    }
  });

  it('[entity:update-remote-project-request] no route accepts the UpdateRemoteProjectRequest body { name, description } any more', async () => {
    const res = await request(t.app).patch(`${t.baseUrl}/remote-project`).send({ name: 'Renamed', description: 'd' });
    expect(res.status).toBe(404);
  });
});
