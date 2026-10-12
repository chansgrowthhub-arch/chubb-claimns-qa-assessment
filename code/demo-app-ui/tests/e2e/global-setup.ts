import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LoginPage } from './pages/login-page';
import { ADMIN, CLAIMANT, type TestUser } from './support/test-users';

/**
 * 1. Logs in each seeded user once and saves cookies + localStorage (Zustand auth-storage) so
 *    specs start authenticated. This file was referenced by the shipped playwright.config.ts but
 *    did not exist, so `npx playwright test` failed before any spec ran.
 * 2. Warms every route. The compose UI runs `next dev`, which compiles a route on its first
 *    request; with parallel workers that first compile exceeded the 30 s test timeout on a cold
 *    container. Visiting each route once here removes that flakiness at its source instead of
 *    raising timeouts.
 */
const ROUTES_TO_WARM: Record<TestUser['role'], string[]> = {
  CLAIMANT: ['/claims', '/claims/new'],
  ADMIN: ['/admin/dashboard', '/admin/claims', '/admin/users'],
};
const COLD_COMPILE_TIMEOUT_MS = 120_000;

async function loginSaveStateAndWarm(baseURL: string, user: TestUser): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  page.setDefaultTimeout(COLD_COMPILE_TIMEOUT_MS);
  await new LoginPage(page).loginAs(user);
  mkdirSync(dirname(user.storageStatePath), { recursive: true });
  await page.context().storageState({ path: user.storageStatePath });
  for (const route of ROUTES_TO_WARM[user.role]) {
    await page.goto(route, { waitUntil: 'networkidle', timeout: COLD_COMPILE_TIMEOUT_MS });
  }
  await browser.close();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3001';
  await loginSaveStateAndWarm(baseURL, ADMIN);
  await loginSaveStateAndWarm(baseURL, CLAIMANT);
}
