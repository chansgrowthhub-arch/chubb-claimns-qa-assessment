import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimsTable } from './claims-table';
import { useRealtimeStore } from '../stores/use-realtime-store';
import type { ClaimSummaryResponse } from '@/src/lib/api/bff-client';

const WATER_DAMAGE_CLAIM: ClaimSummaryResponse = {
  claimId: 'aaaaaaaa-1111-2222-3333-444444444444',
  incidentDate: new Date('2026-01-15T00:00:00Z'),
  description: 'Water damage to basement after a pipe burst during the winter storm season',
  claimAmount: 15000.5,
  status: 'SUBMITTED',
  createdAt: new Date('2026-02-01T10:00:00Z'),
} as ClaimSummaryResponse;

const CAR_ACCIDENT_CLAIM: ClaimSummaryResponse = {
  claimId: 'bbbbbbbb-5555-6666-7777-888888888888',
  incidentDate: new Date('2026-02-20T00:00:00Z'),
  description: 'Rear-end collision at traffic lights',
  claimAmount: 3200,
  status: 'APPROVED',
  createdAt: new Date('2026-02-21T09:00:00Z'),
} as ClaimSummaryResponse;

const renderTable = (onViewDetails = vi.fn()) => {
  render(
    <ClaimsTable
      claims={[WATER_DAMAGE_CLAIM, CAR_ACCIDENT_CLAIM]}
      onViewDetails={onViewDetails}
    />
  );
  return { onViewDetails };
};

const rowFor = (claim: ClaimSummaryResponse): HTMLElement => {
  const idCell = screen.getByText(claim.claimId.substring(0, 8));
  const row = idCell.closest('tr');
  if (!row) throw new Error('claim row not found');
  return row;
};

describe('ClaimsTable', () => {
  beforeEach(() => {
    useRealtimeStore.setState({
      recentlyUpdatedClaimIds: new Set(),
      highlightTimeouts: new Map(),
    });
  });

  it('renders one row per claim with formatted amount, date, and status label', () => {
    renderTable();

    const waterRow = within(rowFor(WATER_DAMAGE_CLAIM));
    expect(waterRow.getByText('$15,000.50')).toBeInTheDocument();
    expect(waterRow.getByText(/jan 15, 2026/i)).toBeInTheDocument();
    expect(waterRow.getByRole('status')).toHaveTextContent('Submitted');

    const carRow = within(rowFor(CAR_ACCIDENT_CLAIM));
    expect(carRow.getByText('$3,200.00')).toBeInTheDocument();
    expect(carRow.getByRole('status')).toHaveTextContent('Approved');
  });

  it('truncates long descriptions but keeps the full text available as a tooltip', () => {
    renderTable();

    const truncated = WATER_DAMAGE_CLAIM.description.substring(0, 50) + '...';
    const cell = screen.getByText(truncated);
    expect(cell).toHaveAttribute('title', WATER_DAMAGE_CLAIM.description);
  });

  it('highlights only the row whose claim was just updated in real time', () => {
    useRealtimeStore.setState({
      recentlyUpdatedClaimIds: new Set([WATER_DAMAGE_CLAIM.claimId]),
    });

    renderTable();

    expect(rowFor(WATER_DAMAGE_CLAIM).className).toContain('bg-yellow-100');
    expect(rowFor(CAR_ACCIDENT_CLAIM).className).not.toContain('bg-yellow-100');
  });

  it('invokes onViewDetails with the full claim id', async () => {
    const user = userEvent.setup();
    const { onViewDetails } = renderTable();

    const viewButton = within(rowFor(CAR_ACCIDENT_CLAIM)).getByTestId('view-details-button');
    await user.click(viewButton);

    expect(onViewDetails).toHaveBeenCalledWith(CAR_ACCIDENT_CLAIM.claimId);
  });

  it('copies the full claim id to the clipboard from the copy affordance', async () => {
    // userEvent.setup() installs its own clipboard stub, so spy on it afterwards.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderTable();

    const copyButton = within(rowFor(WATER_DAMAGE_CLAIM)).getByRole('button', {
      name: /copy full claim id/i,
    });
    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(WATER_DAMAGE_CLAIM.claimId);
  });
});
