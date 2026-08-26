import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { chatRouter } from './chat.js';
import type { AgentTurnDeps } from './agent-turn.js';
import { DEFAULT_MODEL } from '../../core/agent/run-agent.js';

/**
 * `GET /api/chat/config` — the model catalog as the UI sees it.
 *
 * `contextWindows` earns a test of its own because it is the half of this
 * payload with a WRONG answer available. `models` and `default` are wrong only
 * by being absent; the window is wrong by being stale, and a stale window is
 * invisible — the badge still renders a plausible percentage, just against the
 * wrong denominator. That is exactly how it failed before 0.2.17: a hand-kept
 * table in `UsageBadge.tsx` reporting 200k while the default model runs a 1M
 * window, understating occupancy by 5x on the one model most sessions use.
 *
 * So the assertions below are on the SPLIT (1M adaptive vs 200k Haiku) rather
 * than on a per-alias table: a table here would be the third copy of the same
 * numbers, and the point of asking `getModelContextWindow` is that this file
 * does not get to have an opinion about them.
 */
describe('GET /api/chat/config — the claude-code catalog', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-chat-config-')));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = () => {
    const deps = {
      chatService: {},
      agentCredentialService: { getDecrypted: () => null },
      activeAdapters: new Map(),
      pendingInputs: new Map(),
      cwd: dir,
      roots: [],
    } as unknown as AgentTurnDeps;
    return express().use(express.json()).use('/chat', chatRouter(deps));
  };

  const config = async () => {
    const res = await request(app()).get('/chat/config');
    expect(res.status).toBe(200);
    return res.body.architectures['claude-code'] as {
      models: string[];
      default: string;
      contextWindows: Record<string, number>;
    };
  };

  /**
   * 0.2.50 — the Plan Mode toggle is only offered when the deny-groups it
   * desugars to can actually be enforced. Probed server-side because the
   * package's main entry pulls the agent runtime and is not browser-safe.
   */
  it('reports whether plan mode is enforceable on this architecture', async () => {
    const res = await request(app()).get('/chat/config');

    expect(res.status).toBe(200);
    // claude-code enforces all four groups (at `soft` strength), so the toggle
    // is always offered here. The field must be a real boolean, not undefined —
    // the client defaults it to `true` when absent, which would silently mask a
    // route that stopped reporting it.
    expect(res.body.planModeEnforceable).toBe(true);
  });

  it('offers exactly the 0.2.17 aliases, with opus-5 as the default', async () => {
    const cc = await config();
    expect(cc.models).toEqual(['fable-5', 'sonnet-5', 'opus-5', 'haiku-4.5']);
    expect(cc.default).toBe('opus-5');
    // The route must not carry its own literal — the default is resolved once,
    // in `runAgent`, and every channel reads it from there.
    expect(cc.default).toBe(DEFAULT_MODEL);
  });

  it('carries a context window for every offered model', async () => {
    const cc = await config();
    for (const m of cc.models) {
      expect(cc.contextWindows[m], `no context window for ${m}`).toBeGreaterThan(0);
    }
  });

  it('reports 1M for the adaptive models and 200k for haiku-4.5', async () => {
    const cc = await config();
    expect(cc.contextWindows['fable-5']).toBe(1_000_000);
    expect(cc.contextWindows['sonnet-5']).toBe(1_000_000);
    expect(cc.contextWindows['opus-5']).toBe(1_000_000);
    expect(cc.contextWindows['haiku-4.5']).toBe(200_000);
  });

  it('gives the default model a 1M window — the case the old hardcoded 200k got wrong', async () => {
    const cc = await config();
    expect(cc.contextWindows[cc.default]).toBe(1_000_000);
  });
});
