import AxeBuilder from '@axe-core/playwright';
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
