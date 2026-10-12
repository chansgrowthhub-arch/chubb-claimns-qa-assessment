import { expect, type Locator, type Page } from '@playwright/test';

export interface ClaimInput {
  incidentDate: string; // yyyy-mm-dd
  incidentLocation: string;
  claimAmount: string;
  description: string;
}

type WizardStep = 1 | 2 | 3;

/**
 * Every control is scoped to the visible wizard step. The page also contains a header nav
 * button labelled "Submit Claim" and, on the dev server, an "Open Next.js Dev Tools" button,
 * both of which collide with unscoped role queries.
 */
export class ClaimWizardPage {
  constructor(private readonly page: Page) {}

  private step(n: WizardStep): Locator {
    return this.page.getByTestId(`wizard-step-${n}`);
  }

  async goto(): Promise<void> {
    await this.page.goto('/claims/new');
    await expect(this.step(1)).toBeVisible();
  }

  async fillIncidentDetails(claim: ClaimInput): Promise<void> {
    const step = this.step(1);
    await step.getByLabel(/When did the incident occur/).fill(claim.incidentDate);
    await step.getByLabel(/Where did the incident occur/).fill(claim.incidentLocation);
    await step.getByLabel(/Claim Amount/).fill(claim.claimAmount);
    await step.getByRole('button', { name: 'Next', exact: true }).click();
  }

  async fillDescription(description: string): Promise<void> {
    const step = this.step(2);
    await expect(step).toBeVisible();
    await step.getByLabel(/Describe what happened/).fill(description);
    await step.getByRole('button', { name: 'Next', exact: true }).click();
  }

  async submit(): Promise<void> {
    const step = this.step(3);
    await expect(step).toBeVisible();
    await step.getByRole('button', { name: 'Submit Claim', exact: true }).click();
  }

  async submitClaim(claim: ClaimInput): Promise<void> {
    await this.goto();
    await this.fillIncidentDetails(claim);
    await this.fillDescription(claim.description);
    await this.submit();
  }
}
