import { describe, expect, it } from 'vitest';
import { fetchMcp } from './server.js';

const auth = {
  token: 'test',
  clientId: 'test',
  scopes: ['stay/mcp'],
  expiresAt: Math.floor(Date.now() / 1000) + 60,
};

async function rpc(body: unknown, authInfo = auth): Promise<Record<string, unknown>> {
  const result = await fetchMcp(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify(body),
    }),
    authInfo,
  );
  expect(result.status).toBe(200);
  const text = await result.text();
  const json = result.headers.get('content-type')?.includes('text/event-stream')
    ? text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6)
    : text;
  return JSON.parse(json ?? '{}') as Record<string, unknown>;
}

describe('MCP Streamable HTTP contract', () => {
  it('rejects an invalid origin', async () => {
    const result = await fetchMcp(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      }),
      auth,
    );
    expect(result.status).toBe(403);
  });

  it('negotiates the 2025-11-25 protocol and returns accessible text', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'stay-test', version: '1.0.0' },
        },
      }),
    });
    const result = await fetchMcp(request, auth);
    expect(result.status).toBe(200);
    const body = await result.text();
    const json = result.headers.get('content-type')?.includes('text/event-stream')
      ? body
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice(6)
      : body;
    const payload = JSON.parse(json ?? '{}') as {
      result?: { protocolVersion?: string; serverInfo?: { name?: string } };
    };
    expect(payload.result?.protocolVersion).toBe('2025-11-25');
    expect(payload.result?.serverInfo?.name).toBe('STAY');
  });

  it('keeps versioned tool state coherent across stateless HTTP requests', async () => {
    const scopedAuth = {
      ...auth,
      extra: {
        subject: 'resident-mcp-test',
        householdId: 'household-mcp-durability',
        residentId: 'resident-sarah',
      },
    };
    const complete = await rpc(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'manage_task_session',
          arguments: {
            action: 'complete',
            expectedVersion: 1,
            idempotencyKey: 'mcp-task-complete',
          },
        },
      },
      scopedAuth,
    );
    expect(complete).toMatchObject({
      result: { structuredContent: { data: { entity: { state: 'completed', version: 2 } } } },
    });

    const reset = await rpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'manage_task_session',
          arguments: {
            action: 'reset',
            expectedVersion: 2,
            idempotencyKey: 'mcp-task-reset',
          },
        },
      },
      scopedAuth,
    );
    expect(reset).toMatchObject({
      result: { structuredContent: { data: { entity: { state: 'not-started', version: 3 } } } },
    });
  });
});
