import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { chatRouter } from './chat.js';
import type { AgentTurnDeps } from './agent-turn.js';
import { ADAPTIVE_THINKING_ONLY, resolveModel } from '@inharness-ai/agent-adapters';
import { DEFAULT_MODEL } from '../../core/agent/run-agent.js';

/**
 * `GET /api/chat/config` — the model catalog as the UI sees it.
 *
 * 0.2.108: `models` is the server's contract, not picker cosmetics — a narrowed,
 * ordered subset of the adapter catalog, each entry carrying what the alias alone
 * does not: `resolvedId`, `adaptive`, `contextWindow`. The client renders it as
 * received, so the ORDER is asserted too.
 *
 * `adaptive` and `resolvedId` are checked against the library's own exports rather
 * than a table here — this file does not get to have an opinion about them, and the
 * one thing it must pin is the ORDER of operations: `resolveModel` first, then
 * membership of the RESOLVED id. The context windows keep their split assertion
 * (1M vs 200k) because a stale window is invisible: the badge still renders a
 * plausible percentage, just against the wrong denominator.
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
      models: { alias: string; resolvedId: string; adaptive: boolean; contextWindow: number }[];
      default: string;
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
    // claude-code enforces every tool group (at `soft` strength), so the toggle
    // is always offered here. The field must be a real boolean, not undefined —
    // the client defaults it to `true` when absent, which would silently mask a
    // route that stopped reporting it.
    expect(res.body.planModeEnforceable).toBe(true);
  });

  it('offers exactly the four selectable aliases, strongest first, with opus-5.5 as the default', async () => {
    const cc = await config();
    expect(cc.models.map((m) => m.alias)).toEqual(['fable-5.1', 'opus-5.5', 'sonnet-5', 'haiku-4.5']);
    expect(cc.default).toBe('opus-5.5');
    // The route must not carry its own literal — the default is resolved once,
    // in `runAgent`, and every channel reads it from there.
    expect(cc.default).toBe(DEFAULT_MODEL);
  });

  it('keeps opus-5 off the list although the library still resolves it', async () => {
    const cc = await config();
    expect(resolveModel('claude-code', 'opus-5')).toBe('claude-opus-5');
    expect(cc.models.map((m) => m.alias)).not.toContain('opus-5');
  });

  it('serves each entry as { alias, resolvedId, adaptive, contextWindow } and nothing else', async () => {
    const cc = await config();
    for (const m of cc.models) {
      expect(Object.keys(m).sort()).toEqual(['adaptive', 'alias', 'contextWindow', 'resolvedId']);
    }
    expect(cc).not.toHaveProperty('contextWindows');
  });

  it('takes resolvedId from resolveModel — dated for haiku-4.5, undated for the rest', async () => {
    const cc = await config();
    for (const m of cc.models) expect(m.resolvedId).toBe(resolveModel('claude-code', m.alias));
    const byAlias = Object.fromEntries(cc.models.map((m) => [m.alias, m.resolvedId]));
    expect(byAlias).toEqual({
      'fable-5.1': 'claude-fable-5-1',
      'opus-5.5': 'claude-opus-5-5',
      'sonnet-5': 'claude-sonnet-5',
      'haiku-4.5': 'claude-haiku-4-5-20251001',
    });
  });

  it('reads adaptive as membership of the RESOLVED id in ADAPTIVE_THINKING_ONLY', async () => {
    const cc = await config();
    for (const m of cc.models) expect(m.adaptive).toBe(ADAPTIVE_THINKING_ONLY.has(m.resolvedId));
    expect(cc.models.filter((m) => !m.adaptive).map((m) => m.alias)).toEqual(['haiku-4.5']);
  });

  it('reports 1M for the adaptive models and 200k for haiku-4.5', async () => {
    const cc = await config();
    const byAlias = Object.fromEntries(cc.models.map((m) => [m.alias, m.contextWindow]));
    expect(byAlias).toEqual({
      'fable-5.1': 1_000_000,
      'opus-5.5': 1_000_000,
      'sonnet-5': 1_000_000,
      'haiku-4.5': 200_000,
    });
  });
});
