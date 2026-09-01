import { describe, expect, it } from 'vitest';
import { fetchMcp } from './server.js';

const auth = {
  token: 'test',
  clientId: 'test',
  scopes: ['stay/mcp'],
  expiresAt: Math.floor(Date.now() / 1000) + 60,
};

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
});
