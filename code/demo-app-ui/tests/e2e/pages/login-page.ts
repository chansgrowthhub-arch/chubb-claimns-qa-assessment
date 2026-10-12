import { expect, type Page } from '@playwright/test';
import type { TestUser } from '../support/test-users';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  async login(email: string, password: string): Promise<void> {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password', { exact: true }).fill(password);
    await this.page.getByRole('button', { name: 'Log In' }).click();
  }

  async loginAs(user: TestUser): Promise<void> {
    await this.goto();
    await this.login(user.email, user.password);
    await expect(this.page).toHaveURL(new RegExp(`${user.landingPath}$`));
  }

  async expectError(message: RegExp): Promise<void> {
    await expect(this.page.getByRole('alert').filter({ hasText: message })).toBeVisible();
  }
}
