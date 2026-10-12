import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LoginPage } from './pages/login-page';
import { ADMIN, CLAIMANT, type TestUser } from './support/test-users';

/**
 * Logs in each seeded user once and saves cookies + localStorage (Zustand auth-storage)
 * so specs start authenticated. This file was referenced by the shipped playwright.config.ts
 * but did not exist, so `npx playwright test` failed before any spec ran.
 */
async function saveStorageState(baseURL: string, user: TestUser): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await new LoginPage(page).loginAs(user);
  mkdirSync(dirname(user.storageStatePath), { recursive: true });
  await page.context().storageState({ path: user.storageStatePath });
  await browser.close();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3001';
  await saveStorageState(baseURL, ADMIN);
  await saveStorageState(baseURL, CLAIMANT);
}
