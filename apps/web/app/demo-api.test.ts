import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StayRuntimeConfig } from './auth';
import { runDemoCommand, type DemoSessionRecord } from './demo-api';

const config: StayRuntimeConfig = {
  apiUrl: 'https://saystay.site',
  websocketUrl: 'wss://socket.example/prod',
  cognitoBaseUrl: 'https://stay.auth.us-east-1.amazoncognito.com',
  publicClientId: 'client',
  redirectUri: 'https://saystay.site/auth/callback',
  logoutUri: 'https://saystay.site/',
};

afterEach(() => vi.unstubAllGlobals());

describe('STAY API session routing', () => {
  it('uses the authenticated route and bearer token after Cognito sign-in', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entity: { id: 'task-one-thing', version: 2, state: 'completed' },
          version: 2,
          emittedEvents: [],
          confirmationRequired: null,
          provenance: { mode: 'live', provider: 'STAY', observedAt: new Date().toISOString() },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await runDemoCommand(
      config,
      {
        mode: 'authenticated',
        accessToken: 'signed-access-token',
        expiresAt: Date.now() + 60_000,
      },
      {
        group: 'tasks',
        action: 'complete',
        idempotencyKey: 'authenticated-task-complete',
        expectedVersion: 1,
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://saystay.site/v1/tasks',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer signed-access-token' }),
      }),
    );
  });

  it('keeps public sessions on the isolated demo route', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entity: { id: 'task-one-thing', version: 2 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const session: DemoSessionRecord = {
      id: 'demo-session-test',
      mode: 'isolated-demo',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      isolation: 'isolated',
    };

    await runDemoCommand(config, session, {
      group: 'tasks',
      action: 'complete',
      idempotencyKey: 'demo-task-complete',
      expectedVersion: 1,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://saystay.site/v1/demo/tasks',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-stay-demo-session': 'demo-session-test' }),
      }),
    );
  });
});
