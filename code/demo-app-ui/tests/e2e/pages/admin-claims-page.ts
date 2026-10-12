import { expect, type Locator, type Page } from '@playwright/test';

export class AdminClaimsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin/claims');
    await expect(this.page.getByRole('heading', { name: 'Claims Management' })).toBeVisible();
  }

  // The page renders a desktop table AND a CSS-hidden mobile card list with the same
  // controls, so every locator is scoped to the table row to avoid strict-mode duplicates.
  rowFor(claimId: string): Locator {
    return this.page.locator('table tr', { hasText: claimId.substring(0, 8) });
  }

  statusSelect(claimId: string): Locator {
    return this.rowFor(claimId).getByTestId(`status-select-${claimId.substring(0, 8)}`);
  }

  async changeStatus(claimId: string, statusLabel: string): Promise<void> {
    await this.statusSelect(claimId).selectOption({ label: statusLabel });
    const dialog = this.page.getByRole('dialog', { name: 'Confirm Status Change' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm' }).click();
  }

  async expectStatus(claimId: string, statusLabel: string): Promise<void> {
    await expect(this.rowFor(claimId).getByRole('status')).toHaveText(statusLabel);
  }
}
