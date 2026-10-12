import { test, expect, type Page } from '@playwright/test';
import { ClaimWizardPage, type ClaimInput } from './pages/claim-wizard-page';
import { AdminClaimsPage } from './pages/admin-claims-page';
import { ADMIN, CLAIMANT } from './support/test-users';

/**
 * Highest-value journey: claimant submits a claim through the 3-step wizard (UI -> BFF ->
 * claims-service -> Postgres), then an admin moves it through the status machine and the
 * claimant sees the result. Runs serially because steps share one claim.
 */
test.describe.configure({ mode: 'serial' });

const uniqueLocation = `E2E Lane ${Date.now()}, Springfield`;
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const CLAIM: ClaimInput = {
  incidentDate: yesterday,
  incidentLocation: uniqueLocation,
  claimAmount: '2500.75',
  description: 'Hail storm cracked the windscreen and dented the bonnet while parked.',
};

let claimId = '';

async function asUser(browser: import('@playwright/test').Browser, storageState: string): Promise<Page> {
  const context = await browser.newContext({ storageState });
  return context.newPage();
}

test('claimant submits a claim and sees it listed as Submitted', async ({ browser }) => {
  const page = await asUser(browser, CLAIMANT.storageStatePath);

  const submitResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/claims') && r.request().method() === 'POST'
  );
  await new ClaimWizardPage(page).submitClaim(CLAIM);

  const response = await submitResponse;
  expect(response.status()).toBe(201);
  claimId = (await response.json()).claimId;

  await expect(page).toHaveURL(/\/claims$/);
  const row = page.locator('tr', { hasText: claimId.substring(0, 8) });
  await expect(row.getByRole('status')).toHaveText('Submitted');
  await expect(row).toContainText('$2,500.75');
});

test('admin moves the claim to Under Review and then Approved', async ({ browser }) => {
  test.skip(!claimId, 'depends on the claim created in the previous test');
  const page = await asUser(browser, ADMIN.storageStatePath);
  const adminClaims = new AdminClaimsPage(page);

  await adminClaims.goto();
  await adminClaims.changeStatus(claimId, 'Under Review');
  await adminClaims.expectStatus(claimId, 'Under Review');

  await adminClaims.changeStatus(claimId, 'Approved');
  await adminClaims.expectStatus(claimId, 'Approved');
});

test('admin is not offered illegal transitions for an Approved claim', async ({ browser }) => {
  test.skip(!claimId, 'depends on the claim created in the first test');
  const page = await asUser(browser, ADMIN.storageStatePath);
  await new AdminClaimsPage(page).goto();

  const options = page.getByTestId(`status-select-${claimId.substring(0, 8)}`).locator('option:not([disabled])');
  await expect(options).toHaveText(['Closed']);
});

test('claimant sees the approved status after reload', async ({ browser }) => {
  test.skip(!claimId, 'depends on the claim created in the first test');
  const page = await asUser(browser, CLAIMANT.storageStatePath);
  await page.goto('/claims');

  const row = page.locator('tr', { hasText: claimId.substring(0, 8) });
  await expect(row.getByRole('status')).toHaveText('Approved');
});
