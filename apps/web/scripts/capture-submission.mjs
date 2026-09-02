import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const baseUrl = process.env.STAY_CAPTURE_URL ?? 'http://127.0.0.1:3000';
const captureVideo = process.env.STAY_CAPTURE_VIDEO !== 'false';
const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const screenshotDir = path.join(workspaceRoot, 'assets/submission/screenshots');
const videoDir = path.join(workspaceRoot, 'assets/submission/video');
const rawVideoDir = path.join(videoDir, '.raw');

await Promise.all([
  mkdir(screenshotDir, { recursive: true }),
  mkdir(videoDir, { recursive: true }),
  mkdir(rawVideoDir, { recursive: true }),
]);

const browser = await chromium.launch(
  process.env.STAY_BROWSER_PATH ? { executablePath: process.env.STAY_BROWSER_PATH } : {},
);

async function ready(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.locator('main[data-ready="true"]').waitFor({ timeout: 90_000 });
}

async function shot(page, name, fullPage = false) {
  await page.screenshot({
    path: path.join(screenshotDir, name),
    fullPage,
  });
}

const desktop = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
});
await ready(desktop);
await shot(desktop, '01-home-desktop.png');

await desktop.getByRole('button', { name: 'Access', exact: true }).click();
await shot(desktop, '02-access-desktop.png');

await desktop.getByRole('button', { name: 'Privacy', exact: true }).click();
await shot(desktop, '03-privacy-desktop.png');

await desktop.getByRole('button', { name: 'Today', exact: true }).click();
for (const label of [
  'Miss the first check',
  'Miss the second check',
  'Sarah asks Tom',
  'Tom accepts',
]) {
  await desktop.getByRole('button', { name: label, exact: true }).click();
}
await desktop.getByRole('heading', { name: 'Tom is on the way.' }).first().waitFor();
await shot(desktop, '04-tom-on-the-way-desktop.png');

await desktop.getByLabel('Type an Alexa phrase').fill('I need emergency help');
await desktop.getByRole('button', { name: 'Send phrase' }).click();
await desktop
  .getByText(/does not contact emergency services/i)
  .last()
  .waitFor();
await desktop
  .getByLabel('Conversation transcript')
  .evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
await shot(desktop, '05-emergency-boundary-desktop.png');

const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
});
await ready(mobile);
await shot(mobile, '06-home-mobile.png', true);

if (captureVideo) {
  const videoContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    recordVideo: { dir: rawVideoDir, size: { width: 1920, height: 1080 } },
  });
  const videoPage = await videoContext.newPage();
  const video = videoPage.video();

  async function pause(milliseconds) {
    await videoPage.waitForTimeout(milliseconds);
  }

  await ready(videoPage);
  await pause(18000);
  await videoPage.getByRole('button', { name: 'Access', exact: true }).click();
  await pause(15000);
  await videoPage.getByRole('button', { name: 'Privacy', exact: true }).click();
  await pause(11000);
  await videoPage.getByRole('button', { name: 'Today', exact: true }).click();
  await pause(4000);

  for (const [label, hold] of [
    ['Miss the first check', 16000],
    ['Miss the second check', 18000],
    ['Sarah asks Tom', 16000],
    ['Tom accepts', 16000],
  ]) {
    await videoPage.getByRole('button', { name: label, exact: true }).click();
    await pause(hold);
  }

  await videoPage.getByRole('button', { name: 'Help Board', exact: true }).click();
  await pause(6000);
  await videoPage.getByRole('button', { name: 'Plans', exact: true }).click();
  await pause(6000);
  await videoPage.getByRole('button', { name: 'House Memory', exact: true }).click();
  await pause(6000);
  await videoPage.getByLabel('Type an Alexa phrase').fill('I need emergency help');
  await videoPage.getByRole('button', { name: 'Send phrase' }).click();
  await videoPage
    .getByText(/does not contact emergency services/i)
    .last()
    .waitFor();
  await videoPage
    .getByLabel('Conversation transcript')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await pause(17000);

  await videoContext.close();
  await video.saveAs(path.join(videoDir, 'stay-screen-capture.webm'));
}
await browser.close();

process.stdout.write(`Captured six screenshots in ${screenshotDir}\n`);
if (captureVideo) {
  process.stdout.write(`Captured the picture-only walkthrough in ${videoDir}\n`);
}
