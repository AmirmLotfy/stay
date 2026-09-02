import AxeBuilder from '@axe-core/playwright';
import { createDemoState } from '@stay/domain';
import { expect, test } from '@playwright/test';

test('runs the protected missed-window flow with touch alone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good morning, Sarah.' })).toBeVisible();
  await page.getByRole('button', { name: 'Miss the first check' }).click();
  await page.getByRole('button', { name: 'Miss the second check' }).click();
  await page.getByRole('button', { name: 'Sarah asks Tom' }).click();
  await page.getByRole('button', { name: 'Tom accepts' }).click();
  await expect(page.getByText('Tom is on the way.', { exact: true }).first()).toBeVisible();
});

test('supports keyboard navigation and has no serious automatic accessibility findings', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? '')),
  ).toEqual([]);
});

test('shows a clear emergency boundary in the voice simulator', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Type an Alexa phrase');
  await input.fill('This is an emergency, get help');
  await input.press('Enter');
  await expect(page.getByText(/does not contact emergency services/i)).toBeVisible();
});

test('uses the deployed TTL-isolated API session when runtime configuration is present', async ({
  page,
}) => {
  const fixture = createDemoState();
  const commands: Array<Record<string, unknown>> = [];
  let safetyWindow = structuredClone(fixture.safetyWindows[0]!);
  let incident: (typeof fixture.incidents)[number] | null = null;
  await page.route('**/config.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        apiUrl: 'http://127.0.0.1:3000/api',
        websocketUrl: 'ws://127.0.0.1:3000/socket',
        cognitoBaseUrl: 'https://stay-auth.example.test',
        publicClientId: 'public-client',
        redirectUri: 'http://127.0.0.1:3000/auth/callback',
        logoutUri: 'http://127.0.0.1:3000/',
      }),
    });
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/demo-sessions')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'demo-00000000-0000-4000-8000-000000012345',
          mode: 'isolated-demo',
          createdAt: '2026-09-02T06:20:00.000Z',
          expiresAt: '2099-09-02T10:20:00.000Z',
          isolation: 'This session cannot read or write authenticated households.',
        }),
      });
      return;
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      commands.push(body);
      let entity: typeof safetyWindow | NonNullable<typeof incident>;
      if (body.action === 'record-missed-check') {
        const checkAttempts = Math.min(2, safetyWindow.checkAttempts + 1);
        safetyWindow = {
          ...safetyWindow,
          checkAttempts,
          state: checkAttempts === 1 ? 'first-check-missed' : 'escalating',
          version: safetyWindow.version + 1,
        };
        entity = safetyWindow;
      } else if (body.action === 'activate-from-window') {
        incident = {
          id: 'incident-window-morning',
          residentId: 'resident-sarah',
          kind: 'missed-window',
          title: 'Sarah missed her morning check-in',
          state: 'coordinating',
          severity: 'attention',
          accessInstructionsAvailable: true,
          createdAt: '2026-09-02T06:40:00.000Z',
          version: 1,
          timeline: [
            {
              id: 'incident-activated',
              at: '2026-09-02T06:40:00.000Z',
              kind: 'incident-activated',
              title: 'Circle coordination started',
              detail: 'No emergency service was contacted.',
              actorName: 'STAY',
            },
          ],
        };
        entity = incident;
      } else if (body.action === 'ask-responder' && incident) {
        incident = { ...incident, version: incident.version + 1 };
        entity = incident;
      } else if (body.action === 'accept' && incident) {
        incident = {
          ...incident,
          state: 'responding',
          assignedMemberId: 'member-tom',
          version: incident.version + 1,
        };
        entity = incident;
      } else {
        throw new Error(`Unexpected mocked command: ${String(body.action)}`);
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          entity,
          version: entity.version,
          emittedEvents: [],
          confirmationRequired: null,
          provenance: {
            mode: 'live',
            provider: 'STAY API test fixture',
            observedAt: '2026-09-02T06:20:00.000Z',
          },
        }),
      });
      return;
    }
    const group = path.split('/').at(-1);
    const data: Record<string, unknown> = {
      home: {
        resident: fixture.resident,
        oneThing: fixture.oneThing,
        calendar: fixture.calendar,
      },
      access: fixture.access,
      circle: fixture.circle,
      'safety-windows': [safetyWindow],
      'help-requests': fixture.helpRequests,
      incidents: incident ? [incident] : [],
      playbooks: fixture.playbooks,
      privacy: fixture.privacy,
      'house-memory': fixture.houseMemory.filter((item) => item.sensitivity !== 'incident-only'),
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: data[group ?? ''] }),
    });
  });

  await page.goto('/');
  await expect(page.getByText('Isolated AWS demo · 12345')).toBeVisible();
  await page.getByRole('button', { name: 'Miss the first check' }).click();
  await page.getByRole('button', { name: 'Miss the second check' }).click();
  await page.getByRole('button', { name: 'Sarah asks Tom' }).click();
  await page.getByRole('button', { name: 'Tom accepts' }).click();
  await expect(page.getByText('Tom is on the way.', { exact: true }).first()).toBeVisible();
  expect(commands.map((command) => command.action)).toEqual([
    'record-missed-check',
    'record-missed-check',
    'activate-from-window',
    'ask-responder',
    'accept',
  ]);
  expect(commands.map((command) => command.expectedVersion)).toEqual([1, 2, 3, 1, 2]);
});
