/**
 * 2.1.88 (M11 `m11dcore`, M05 `6vum1iqz`) — a live peer for the consultation
 * transports (`c4s ask`, `c4s-tools.ask`): a real HTTP server carrying the two
 * project routes the engine calls — `GET /api/projects/:id/config` (health check)
 * and the real `threadsRouter` (`POST /threads`, `POST /threads/:id/ask`) over a
 * real `ChatService` on an in-memory database.
 *
 * The turn itself is not run here: the calling test mocks `runAgentTurn`
 * (`vi.mock('…/server/routes/agent-turn.js')`), because the agent runtime is not
 * what these transports decide. Everything between the caller and the turn —
 * thread creation, the value the peer picks, the recorded origin, the answer
 * processing — is the production code.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/server/db/migrate.js';
import { ChatService } from '../../src/server/services/chat.js';
import { threadsRouter } from '../../src/server/routes/threads.js';
import type { AgentTurnDeps } from '../../src/server/routes/agent-turn.js';
import type { ChatContextType } from '../../src/shared/entities.js';

export interface ConsultationPeer {
  url: string;
  port: number;
  projectId: string;
  db: Database.Database;
  chat: ChatService;
  /** Every thread row the peer holds: value and origin. */
  threads(): Array<{ id: string; context_type: string; consultation: number }>;
  close(): Promise<void>;
}

export async function startConsultationPeer(
  opts: { projectId?: string; contextTypes?: readonly ChatContextType[] } = {},
): Promise<ConsultationPeer> {
  const projectId = opts.projectId ?? 'peer';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-consultation-peer-'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const chat = new ChatService(db);
  const deps = {
    chatService: chat,
    agentCredentialService: { getDecrypted: () => null },
    activeAdapters: new Map(),
    cwd: dir,
    roots: [],
    ...(opts.contextTypes ? { contextTypes: opts.contextTypes } : {}),
  } as unknown as AgentTurnDeps;

  const app = express().use(express.json());
  app.get(`/api/projects/${projectId}/config`, (_req, res) => {
    res.json({ name: projectId, roots: [], writingStyle: null, onboarding: {} });
  });
  app.use(`/api/projects/${projectId}/threads`, threadsRouter(deps));

  const server = http.createServer(app);
  // No host: the dual-stack wildcard, so `localhost` reaches it whichever family
  // it resolves to (the registry's local address is `http://localhost:<port>`).
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://localhost:${port}`,
    port,
    projectId,
    db,
    chat,
    threads: () =>
      db.prepare('SELECT id, context_type, consultation FROM chat_thread ORDER BY created_at, rowid').all() as Array<{
        id: string;
        context_type: string;
        consultation: number;
      }>,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
