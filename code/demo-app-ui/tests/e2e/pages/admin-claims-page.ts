import { expect, type Locator, type Page } from '@playwright/test';

export class AdminClaimsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin/claims');
    await expect(this.page.getByRole('heading', { name: 'Claims Management' })).toBeVisible();
  }

  rowFor(claimId: string): Locator {
    return this.page.locator('tr', { hasText: claimId.substring(0, 8) });
  }

  async changeStatus(claimId: string, statusLabel: string): Promise<void> {
    await this.page.getByTestId(`status-select-${claimId.substring(0, 8)}`).selectOption({ label: statusLabel });
    const dialog = this.page.getByRole('dialog', { name: 'Confirm Status Change' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm' }).click();
  }

  async expectStatus(claimId: string, statusLabel: string): Promise<void> {
    await expect(this.rowFor(claimId).getByRole('status')).toHaveText(statusLabel);
  }
}
