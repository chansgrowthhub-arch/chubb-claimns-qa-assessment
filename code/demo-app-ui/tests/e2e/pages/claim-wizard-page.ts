import { expect, type Page } from '@playwright/test';

export interface ClaimInput {
  incidentDate: string; // yyyy-mm-dd
  incidentLocation: string;
  claimAmount: string;
  description: string;
}

export class ClaimWizardPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/claims/new');
    await expect(this.page.getByTestId('wizard-step-1')).toBeVisible();
  }

  async fillIncidentDetails(claim: ClaimInput): Promise<void> {
    await this.page.getByLabel(/When did the incident occur/).fill(claim.incidentDate);
    await this.page.getByLabel(/Where did the incident occur/).fill(claim.incidentLocation);
    await this.page.getByLabel(/Claim Amount/).fill(claim.claimAmount);
    await this.next();
  }

  async fillDescription(description: string): Promise<void> {
    await expect(this.page.getByTestId('wizard-step-2')).toBeVisible();
    await this.page.getByLabel(/Describe what happened/).fill(description);
    await this.next();
  }

  async submit(): Promise<void> {
    await expect(this.page.getByTestId('wizard-step-3')).toBeVisible();
    await this.page.getByRole('button', { name: 'Submit Claim' }).click();
  }

  async submitClaim(claim: ClaimInput): Promise<void> {
    await this.goto();
    await this.fillIncidentDetails(claim);
    await this.fillDescription(claim.description);
    await this.submit();
  }

  private async next(): Promise<void> {
    await this.page.getByRole('button', { name: 'Next' }).click();
  }
}
