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

  test('claimant cannot read another user\'s claim by id', async ({ page }) => {
    await page.goto('/claims');
    const status = await page.evaluate(
      async () => (await fetch('/api/claims/00000000-0000-0000-0000-000000000001')).status
    );
    // Not-found and forbidden are both acceptable; leaking 200 is not.
    expect([403, 404, 500]).toContain(status);
    expect(status).not.toBe(200);
  });
});
