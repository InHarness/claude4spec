// Agent spike: verifies @inharness-ai/agent-adapters wiring end-to-end before we
// build the full M05 chat pipeline. Runs a fake endpoint store as an in-process
// MCP server, then performs two adapter.execute calls — second one uses
// resumeSessionId to confirm session continuity.
//
// Usage: npx tsx scripts/agent-spike.ts
// Requires: `claude` CLI installed and logged in (subscription).

import { z } from 'zod';
import {
  createAdapter,
  createMcpServer,
  mcpTool,
  AdapterAbortError,
  AdapterInitError,
  AdapterTimeoutError,
} from '@inharness-ai/agent-adapters';

interface FakeEndpoint {
  slug: string;
  method: string;
  path: string;
  summary: string;
}

const store = new Map<string, FakeEndpoint>();

function slugify(method: string, path: string): string {
  const clean = path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `${method.toLowerCase()}-${clean}`;
}

const createEndpoint = mcpTool(
  'create_endpoint',
  'Create a new HTTP endpoint entity. Generates slug from method+path.',
  {
    method: z.string().describe('HTTP method: GET, POST, PUT, PATCH, DELETE'),
    path: z.string().describe('URL path, e.g. /api/users/:id'),
    summary: z.string().optional(),
  },
  async (args) => {
    const method = String(args.method).toUpperCase();
    const path = String(args.path);
    const slug = slugify(method, path);
    if (store.has(slug)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `slug '${slug}' exists`, code: 'SLUG_CONFLICT' }) }],
        isError: true,
      };
    }
    const ep: FakeEndpoint = { slug, method, path, summary: String(args.summary ?? '') };
    store.set(slug, ep);
    return {
      content: [{ type: 'text', text: JSON.stringify({ id: slug, slug, type: 'endpoint' }) }],
    };
  },
);

const listEndpoints = mcpTool(
  'list_endpoints',
  'List all endpoints currently stored.',
  {},
  async () => ({
    content: [{
      type: 'text',
      text: JSON.stringify({ endpoints: [...store.values()], total: store.size }),
    }],
  }),
);

function fmt(obj: unknown): string {
  const s = JSON.stringify(obj);
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}

async function runTurn(prompt: string, systemPrompt: string, resumeSessionId?: string): Promise<string | undefined> {
  const { config } = createMcpServer({ name: 'endpoint-tools', tools: [createEndpoint, listEndpoints] });
  const adapter = createAdapter('claude-code');

  let sessionId: string | undefined;

  try {
    for await (const event of adapter.execute({
      prompt,
      systemPrompt,
      model: 'sonnet-4.6',
      mcpServers: { 'endpoint-tools': config },
      allowedMCPTools: ['mcp__endpoint-tools__create_endpoint', 'mcp__endpoint-tools__list_endpoints'],
      resumeSessionId,
    })) {
      switch (event.type) {
        case 'text_delta':
          process.stdout.write(event.text);
          break;
        case 'thinking':
          // ignore for spike readability
          break;
        case 'tool_use':
          console.log(`\n[tool_use] ${event.toolName} id=${event.toolUseId}`);
          console.log(`           input=${fmt(event.input)}`);
          break;
        case 'tool_result':
          console.log(`[tool_result] id=${event.toolUseId} summary=${fmt(event.summary)}`);
          break;
        case 'result':
          sessionId = event.sessionId;
          console.log(`\n[result] sessionId=${sessionId ?? 'none'} tokens=${event.usage.inputTokens}/${event.usage.outputTokens}`);
          break;
        case 'error':
          console.error(`\n[error] ${event.error.message}`);
          break;
      }
    }
  } catch (err) {
    if (err instanceof AdapterAbortError) console.error('[aborted]');
    else if (err instanceof AdapterTimeoutError) console.error('[timeout]');
    else if (err instanceof AdapterInitError) console.error(`[init error] ${err.message} — is 'claude' CLI installed and logged in?`);
    else throw err;
  }

  return sessionId;
}

async function main() {
  const systemPrompt = [
    'You are a terse specification assistant. Use MCP endpoint tools to manipulate endpoints.',
    'Only reply in 1-2 sentences after tool calls.',
  ].join('\n');

  console.log('=== Turn 1: create two endpoints ===\n');
  const sessionId = await runTurn(
    'Create two endpoints: POST /auth/login (summary "User login") and GET /auth/me (summary "Current user").',
    systemPrompt,
  );
  console.log('\n\nStore after turn 1:', [...store.entries()]);

  if (!sessionId) {
    console.log('\n⚠ No sessionId returned — session resumption unavailable. Adapter may not support it for this architecture.');
    return;
  }

  console.log('\n\n=== Turn 2 (resumed): list endpoints ===\n');
  await runTurn(
    'List the endpoints you just created and tell me their slugs.',
    systemPrompt,
    sessionId,
  );
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
