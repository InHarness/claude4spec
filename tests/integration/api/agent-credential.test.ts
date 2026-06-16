import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { AgentCredentialService } from '../../../src/server/services/agent-credential.js';
import { agentRouter } from '../../../src/server/routes/agent-credential.js';

// Keyring (`secret.key`) lives under `workspaceBaseDir()` = `C4S_HOME` — point it at a
// throwaway temp dir so tests never touch the real `~/.claude4spec/`.
let tmpHome: string;
const prevHome = process.env.C4S_HOME;

beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cred-'));
  process.env.C4S_HOME = tmpHome;
});
afterAll(() => {
  if (prevHome === undefined) delete process.env.C4S_HOME;
  else process.env.C4S_HOME = prevHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const VALID_KEY = 'sk-ant-test-0123456789abcd';

// --- AgentCredentialService (M05) ------------------------------------------

describe('AgentCredentialService', () => {
  let db: Database.Database;
  let svc: AgentCredentialService;

  beforeEach(() => {
    db = createTestDb();
    svc = new AgentCredentialService(db);
  });
  afterEach(() => db.close());

  it('reports not-set on an empty store', () => {
    expect(svc.getStatus()).toEqual({ isSet: false, last4: null });
    expect(svc.getDecrypted()).toBeNull();
  });

  it('encrypts at-rest (no plaintext in the row) and round-trips on decrypt', () => {
    svc.set(VALID_KEY);
    const row = db.prepare('SELECT * FROM agent_credential').get() as {
      api_key_ciphertext: string;
      key_last4: string;
    };
    expect(row.api_key_ciphertext).not.toContain(VALID_KEY);
    expect(row.key_last4).toBe('abcd');
    expect(svc.getStatus()).toEqual({ isSet: true, last4: 'abcd' });
    expect(svc.getDecrypted()).toEqual({ apiKey: VALID_KEY });
  });

  it('upserts (single row) on replace', () => {
    svc.set(VALID_KEY);
    svc.set('sk-ant-second-key-wxyz');
    expect((db.prepare('SELECT COUNT(*) AS n FROM agent_credential').get() as { n: number }).n).toBe(1);
    expect(svc.getDecrypted()).toEqual({ apiKey: 'sk-ant-second-key-wxyz' });
  });

  it('rejects empty and bad-prefix keys with VALIDATION', () => {
    expect(() => svc.set('')).toThrow(/required/i);
    expect(() => svc.set('not-a-key')).toThrow(/sk-ant-/);
  });

  it('clear() is idempotent and returns to not-set', () => {
    svc.set(VALID_KEY);
    expect(svc.clear()).toEqual({ isSet: false, last4: null });
    expect(svc.clear()).toEqual({ isSet: false, last4: null });
    expect(svc.getStatus().isSet).toBe(false);
  });
});

// --- routes /api/agent/credentials -----------------------------------------

describe('GET/PUT/DELETE /agent/credentials', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDb();
    app = express();
    app.use(express.json());
    app.use('/agent', agentRouter(new AgentCredentialService(db)));
  });
  afterEach(() => db.close());

  it('GET returns not-set on an empty store', async () => {
    const res = await request(app).get('/agent/credentials');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isSet: false, last4: null });
  });

  it('PUT with a bad key → 400 VALIDATION', async () => {
    const res = await request(app).put('/agent/credentials').send({ anthropicApiKey: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('PUT a valid key → 200 { isSet, last4 } and never echoes the raw key', async () => {
    const res = await request(app).put('/agent/credentials').send({ anthropicApiKey: VALID_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isSet: true, last4: 'abcd' });
    expect(JSON.stringify(res.body)).not.toContain(VALID_KEY);

    const get = await request(app).get('/agent/credentials');
    expect(get.body).toEqual({ isSet: true, last4: 'abcd' });
  });

  it('DELETE → idempotent 200 not-set', async () => {
    await request(app).put('/agent/credentials').send({ anthropicApiKey: VALID_KEY });
    const first = await request(app).delete('/agent/credentials');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ isSet: false, last4: null });
    const second = await request(app).delete('/agent/credentials');
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ isSet: false, last4: null });
  });
});
