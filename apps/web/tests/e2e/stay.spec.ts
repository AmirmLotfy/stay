import AxeBuilder from '@axe-core/playwright';
import { createDemoState } from '@stay/domain';
import { expect, test } from '@playwright/test';
import process from 'node:process';

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
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? '')),
  ).toEqual([]);
});

test('persists an explicit theme while otherwise following the system preference', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('stay-theme-v1'));
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('light');
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('light');
});

test('keeps compact controls at the STAY 48 pixel touch-target minimum', async ({ page }) => {
  const expectMinimumTarget = async (selector: string) => {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, `${selector} should be visible`).not.toBeNull();
    expect(box!.width, `${selector} width`).toBeGreaterThanOrEqual(48);
    expect(box!.height, `${selector} height`).toBeGreaterThanOrEqual(48);
  };
  const expectAllVisibleButtonsToMeetMinimum = async () => {
    const undersized = await page.locator('button').evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        if (button.closest('nextjs-portal')) return [];
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          rect.width === 0 ||
          rect.height === 0 ||
          (rect.width >= 48 && rect.height >= 48)
        ) {
          return [];
        }
        return [
          {
            name: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? 'unnamed',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        ];
      }),
    );
    expect(undersized).toEqual([]);
  };

  await page.goto('/');
  await expectAllVisibleButtonsToMeetMinimum();
  await expectMinimumTarget('.echo-action');
  await page.getByRole('button', { name: /Open notifications/ }).click();
  await expectMinimumTarget('.icon-button.small');
  await page.getByRole('button', { name: 'Close updates panel' }).click();

  const navigate = async (
    name: 'Access' | 'Windows' | 'Circle' | 'Plans' | 'Privacy' | 'House Memory',
  ) => {
    const menu = page.getByRole('button', { name: 'Open menu' });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name }).click();
    await expectAllVisibleButtonsToMeetMinimum();
  };

  await navigate('Access');
  await expectMinimumTarget('.switch');
  await navigate('Windows');
  await expectMinimumTarget('.template-card button');
  await navigate('Circle');
  const circleNavigation = page.getByRole('navigation', { name: 'Circle navigation' });
  for (const destination of ['Help Board', 'Incidents', 'People', 'Circle settings']) {
    await circleNavigation.getByRole('button', { name: destination, exact: true }).click();
    await expectAllVisibleButtonsToMeetMinimum();
  }
  await navigate('Plans');
  await navigate('Privacy');
  await navigate('House Memory');
});

test('keeps the mobile shell aligned when the document direction is RTL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good morning, Sarah.' })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByRole('button', { name: 'Open menu' }).click();
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
  await expect(sidebar).toHaveCSS('transform', 'none');
  const sidebarState = await sidebar.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      insetInlineStart: style.insetInlineStart,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(sidebarState).toEqual({ insetInlineStart: '0px', overflow: 0 });
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
  await page.getByRole('button', { name: /Open notifications/ }).click();
  const updates = page.getByRole('region', { name: 'Updates' });
  await expect(updates).toBeVisible();
  await expect(updates.getByText('Bring in a grocery delivery')).toBeVisible();
  await expect(updates.getByText('Sarah’s home is settled.')).toBeVisible();
  await page.getByRole('button', { name: 'Close updates panel' }).click();
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
  await page.getByRole('button', { name: 'Turn on now' }).click();
  await expect(page.getByText('On now', { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel('Alexa Plus simulator')
      .getByText(/Path lighting is on in this clearly labeled simulation/),
  ).toBeVisible();

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
  await expect(page.getByRole('status')).toContainText(/Afternoon return is scheduled/i);

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

test('keeps the mobile header compact and makes updates keyboard-operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByLabel('STAY, Sarah’s home is settled')).toBeVisible();
  await expect(page.getByText('Home settled', { exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const notifications = page.getByRole('button', { name: /Open notifications/ });
  await notifications.click();
  await expect(page.getByRole('region', { name: 'Updates' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Updates' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open notifications' })).toBeFocused();
});

test('uses the deployed TTL-isolated API session when runtime configuration is present', async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.STAY_E2E_BASE_URL),
    'This route-mocked contract case runs against the local build; live tests exercise the real API.',
  );
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
        devices: fixture.devices,
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

test('manages Circle membership and complete playbook run controls by touch', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Browser-only demo|Isolated AWS demo/)).toBeVisible();

  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Circle' }).click();
  await page.getByRole('button', { name: 'People' }).click();
  await page.getByRole('button', { name: 'Add person' }).click();
  await page.getByLabel('Name').fill('Nora Fields');
  await page.getByLabel('Relationship').fill('Friend · backup contact');
  await page.getByLabel('Role').selectOption('backup');
  await page.getByLabel('Priority').fill('5');
  await page.getByLabel('Usual response, minutes').fill('20');
  await page.getByRole('button', { name: 'Add to Circle' }).click();

  const nora = page.locator('.circle-person-manage').filter({ hasText: 'Nora Fields' });
  await expect(nora).toBeVisible();
  await nora.getByRole('button', { name: 'Change availability' }).click();
  await expect(nora.getByText('busy')).toBeVisible();
  await nora.getByRole('button', { name: 'Remove' }).click();
  await nora.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(nora).toHaveCount(0);

  await page.getByRole('button', { name: 'Incidents', exact: true }).click();
  await page.getByRole('button', { name: 'Report a home incident' }).click();
  await page.getByLabel('What happened?').selectOption('water-leak');
  await page.getByLabel('Short description').fill('Water near the kitchen sink');
  await page.getByRole('button', { name: 'Record for verification' }).click();
  await expect(page.getByText('detected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Begin verification' }).click();
  await page.getByRole('button', { name: 'Activate resident plan' }).click();
  await page.getByRole('button', { name: 'Begin Circle coordination' }).click();
  await expect(page.getByText('coordinating', { exact: true })).toBeVisible();

  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Plans' }).click();
  const powerPlan = page.locator('.playbook-card').filter({ hasText: 'Power Outage' });
  await powerPlan.getByRole('button', { name: 'Start plan' }).click();
  await powerPlan.getByRole('button', { name: 'Pause' }).click();
  await powerPlan.getByRole('button', { name: 'Resume' }).click();
  await powerPlan.getByRole('button', { name: 'Cancel' }).click();
  await powerPlan.getByRole('button', { name: 'Reset' }).click();
  await expect(powerPlan.getByRole('button', { name: 'Start plan' })).toBeVisible();
});
