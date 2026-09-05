import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('keeps pilot onboarding empty, saves preferences, and removes revoked household data', async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.STAY_E2E_BASE_URL),
    'Pilot contract fixture is local-only; deployed pilot needs real identities.',
  );
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'stay.oauth-tokens',
      JSON.stringify({ access_token: 'pilot-test', expires_at: Date.now() + 3_600_000 }),
    ),
  );
  await page.route('**/config.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        environment: 'pilot',
        apiUrl: 'http://127.0.0.1:3107/api',
        websocketUrl: 'ws://127.0.0.1:3107/socket',
        cognitoBaseUrl: 'https://identity.example.test',
        publicClientId: 'pilot',
        redirectUri: 'http://127.0.0.1:3107/auth/callback',
        logoutUri: 'http://127.0.0.1:3107/',
      }),
    }),
  );
  let revoked = false;
  let preference = { id: 'subject-ava', version: 1, enabled: true, suppression: 'none' };
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/').at(-1)!;
    expect(path).not.toBe('demo-sessions');
    expect(route.request().headers().authorization).toBe('Bearer pilot-test');
    if (revoked) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Household membership is inactive.' }),
      });
      return;
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      commands.push(body);
      expect(path).toBe('notification-preferences');
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      preference = { ...preference, enabled: body.enabled, version: preference.version + 1 };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ entity: preference }),
      });
      return;
    }
    const data =
      path === 'session'
        ? {
            subject: 'subject-ava',
            role: 'resident',
            permissions: ['help:request', 'safety-window:manage', 'incident:read'],
          }
        : path === 'profile'
          ? {
              id: 'house-ava',
              version: 1,
              name: 'Ava Jones',
              firstName: 'Ava',
              timezone: 'Africa/Cairo',
            }
          : path === 'notification-preferences'
            ? preference
            : [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ava’s home' })).toBeVisible();
  await expect(
    page.getByText('Your operator can help invite your first trusted helper.'),
  ).toBeVisible();
  await expect(page.getByText('No checks are scheduled.', { exact: false })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Sarah');
  await expect(page.locator('body')).not.toContainText('Tom');
  await page.getByRole('button', { name: 'Profile and email' }).click();
  await page.getByLabel('I want household updates at my verified email address.').uncheck();
  await page.getByRole('button', { name: 'Save email preference' }).click();
  await expect(page.getByRole('status')).toContainText('Your email preference is saved.');
  expect(commands).toEqual([{ action: 'update', expectedVersion: 1, enabled: false }]);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/pilot-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  revoked = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'inactive' })).toContainText('inactive');
  await expect(page.locator('body')).not.toContainText('Ava’s home');
});
