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
  await page.getByRole('button', { name: 'Resolve incident' }).click();
  await expect(page.getByText('Sarah is okay', { exact: true })).toBeVisible();
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

test('makes adaptive access, routine help, and resident check-in controls functional', async ({
  page,
}) => {
  const navigate = async (
    name: 'Today' | 'Access' | 'Windows' | 'Circle' | 'Plans' | 'Privacy' | 'House Memory',
  ) => {
    const menu = page.getByRole('button', { name: 'Open menu' });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name }).click();
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByText('No new notifications. Sarah’s home remains settled.')).toBeVisible();
  await page.getByRole('button', { name: 'Tell me more' }).click();
  await expect(
    page.locator('.transcript p.stay').filter({ hasText: 'The bin is beside the back door.' }),
  ).toBeVisible();
  const taskButton = page.getByRole('button', { name: 'Mark the recycling reminder complete' });
  await taskButton.click();
  await expect(
    page.getByRole('button', { name: 'Make the recycling reminder active again' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Full home check' }).click();
  await expect(page.getByText('Front and side doors reported closed.')).toBeVisible();

  await navigate('Access');
  await page.getByRole('switch', { name: 'One Thing Mode' }).click();
  await page.getByRole('radio', { name: 'extra large' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.textScale))
    .toBe('extra-large');
  await navigate('Today');
  await expect(page.getByRole('heading', { name: 'Today at home' })).toBeHidden();

  await navigate('Windows');
  await page.getByRole('button', { name: 'I’m okay' }).click();
  await expect(page.getByText('Sarah checked in', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set up Arrived home' }).click();
  await page.getByLabel('Window name').fill('Afternoon return');
  await page.getByRole('button', { name: 'Schedule window' }).click();
  await expect(page.getByText(/Afternoon return is scheduled/i)).toBeVisible();

  await navigate('Circle');
  await page
    .getByRole('navigation', { name: 'Circle navigation' })
    .getByRole('button', { name: 'Help Board' })
    .click();
  await page.getByRole('button', { name: 'Tom accepts' }).click();
  await expect(page.getByText('Owned by Tom')).toBeVisible();
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New request' }).click();
  await page.getByLabel('What do you need?').fill('Replace the porch light');
  await page
    .getByLabel('Helpful detail')
    .fill('Please bring a warm LED bulb before tomorrow evening.');
  await page.getByRole('button', { name: 'Post to my Circle' }).click();
  await expect(page.getByRole('heading', { name: 'Replace the porch light' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Circle navigation' })
    .getByRole('button', { name: 'Overview' })
    .click();
  await page.getByRole('button', { name: 'View everyone' }).click();
  await expect(page.getByRole('heading', { name: 'People Sarah trusts' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Circle navigation' })
    .getByRole('button', { name: 'Circle settings' })
    .click();
  await page.getByRole('switch', { name: 'Share routine status' }).click();
  await expect(page.getByRole('switch', { name: 'Share routine status' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  await navigate('House Memory');
  await page.getByRole('button', { name: 'Add a house detail' }).click();
  await page.getByLabel('Short label').fill('Porch bulb');
  await page.getByLabel('House detail').fill('Warm LED, E26 base');
  await page.getByLabel('Category').selectOption('maintenance');
  await page.getByRole('button', { name: 'Save house detail' }).click();
  await expect(page.getByRole('heading', { name: 'Porch bulb' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Porch bulb' }).click();
  await page.getByLabel('House detail').fill('Warm LED, E26 base, 800 lumens');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Warm LED, E26 base, 800 lumens')).toBeVisible();

  await navigate('Plans');
  await page.getByRole('button', { name: 'New custom plan' }).click();
  await page.getByLabel('Plan name').fill('Elevator outage');
  await page
    .getByLabel('Steps, one per line')
    .fill('Stay inside the apartment\nAsk Maya to check the building notice');
  await page.getByRole('button', { name: 'Save custom plan' }).click();
  await expect(page.getByRole('heading', { name: 'Elevator outage' })).toBeVisible();

  await navigate('Privacy');
  await page.getByRole('button', { name: 'Private for 2 hours' }).click();
  await expect(page.getByRole('heading', { name: 'Routine sharing paused' })).toBeVisible();
  await page.getByRole('button', { name: 'End private time' }).click();
  await expect(page.getByRole('button', { name: 'Confirm end private time' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm end private time' }).click();
  await expect(page.getByRole('heading', { name: 'Everyday sharing' })).toBeVisible();
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
          createdAt: '2026-09-02T10:20:00.000Z',
          expiresAt: '2099-09-02T10:20:00.000Z',
          isolation: 'This session cannot read or write authenticated households.',
        }),
      });
      return;
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      if (path.endsWith('/intent')) {
        expect(Object.keys(body).sort()).toEqual([
          'currentSurface',
          'locale',
          'utterance',
          'visibleEntityIds',
        ]);
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            intent: {
              toolName: 'get_home_overview',
              action: 'read',
              explanation: 'I understood that you want today’s home overview.',
              explicitEmergencyLanguage: false,
            },
          }),
        });
        return;
      }
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
          createdAt: '2026-09-02T10:40:00.000Z',
          version: 1,
          timeline: [
            {
              id: 'incident-activated',
              at: '2026-09-02T10:40:00.000Z',
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
            observedAt: '2026-09-02T10:20:00.000Z',
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
  const phrase = page.getByLabel('Type an Alexa phrase');
  await phrase.fill('What is happening today?');
  await phrase.press('Enter');
  await expect(
    page.getByText('I understood that you want today’s home overview. No action was taken.'),
  ).toBeVisible();
  expect(commands.map((command) => command.action)).toEqual([
    'record-missed-check',
    'record-missed-check',
    'activate-from-window',
    'ask-responder',
    'accept',
  ]);
  expect(commands.map((command) => command.expectedVersion)).toEqual([1, 2, 3, 1, 2]);
});
