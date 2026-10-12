import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/login-page';
import { ADMIN, CLAIMANT } from './support/test-users';

test.describe('authentication', () => {
  test('rejects wrong credentials with a clear message', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(CLAIMANT.email, 'Definitely-Wrong-1');
    await login.expectError(/invalid email or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('routes each role to its landing page', async ({ page }) => {
    await new LoginPage(page).loginAs(ADMIN);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
  });

  test('redirects anonymous visitors from protected routes to login', async ({ page }) => {
    await page.goto('/claims');
    await expect(page).toHaveURL(/\/login\?redirect=%2Fclaims/);
  });

  /**
   * DEFECT (TEST_STRATEGY.md 4-C): logout POST lacks the X-XSRF-TOKEN header, the BFF answers
   * 403 and the httpOnly access_token cookie survives. Expected to fail until fixed.
   */
  test('logout invalidates the server session', async ({ page }) => {
    test.fail(true, 'Known defect 4-C: logout is rejected by CSRF protection');
    await new LoginPage(page).loginAs(CLAIMANT);

    const logoutResponse = page.waitForResponse((r) => r.url().endsWith('/api/auth/logout'));
    await page.getByRole('button', { name: 'Logout' }).click();
    expect((await logoutResponse).status()).toBe(204);

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'access_token')).toBeUndefined();
  });
});

test.describe('role-based access', () => {
  test.use({ storageState: CLAIMANT.storageStatePath });

  test('claimant calling an admin API directly receives 403', async ({ page }) => {
    await page.goto('/claims');
    const status = await page.evaluate(async () => (await fetch('/api/admin/claims')).status);
    expect(status).toBe(403);
  });

  test('claimant never receives claim data for an id they do not own', async ({ page }) => {
    await page.goto('/claims');
    const status = await page.evaluate(
      async () => (await fetch('/api/claims/00000000-0000-0000-0000-000000000001')).status
    );
    // Security guard: whatever the error code, the data must not leak.
    expect(status).not.toBe(200);
  });

  /**
   * DEFECT (TEST_STRATEGY.md): claims-service answers 404/403 with a ProblemDetail, but the BFF
   * ClaimsServiceAdapter wraps both in IllegalStateException, so the browser gets a bare 500.
   * Verified live for a missing claim and for another user's claim.
   */
  test('missing claim returns 404 as the BFF contract specifies', async ({ page }) => {
    test.fail(true, 'Known defect: BFF converts claims-service 404/403 into 500');
    await page.goto('/claims');
    const status = await page.evaluate(
      async () => (await fetch('/api/claims/00000000-0000-0000-0000-000000000001')).status
    );
    expect(status).toBe(404);
  });
});
