import { describe, it, expect, afterEach } from 'vitest';
import { ClaimSummaryResponseFromJSON } from '@/src/lib/api/generated';
import { formatDate } from './formatting';

/**
 * DEFECT (TEST_STRATEGY.md section 4): incidentDate is a date-only value ("2026-10-01"), but the
 * generated API client turns it into `new Date("2026-10-01")`, i.e. UTC midnight. formatDate then
 * renders it in the browser's local zone, so anyone west of UTC sees the previous day.
 * Verified on the live stack: New York / Los Angeles show "Sep 30, 2026" for "2026-10-01".
 *
 * `it.fails` keeps CI green while the defect exists and turns red the moment it is fixed,
 * prompting removal of the marker.
 */
const ORIGINAL_TZ = process.env.TZ;
const INCIDENT_DATE = '2026-10-01';
const EXPECTED_LABEL = 'Oct 1, 2026';

const summaryWithIncidentDate = (incidentDate: string) =>
  ClaimSummaryResponseFromJSON({
    claimId: '11111111-2222-3333-4444-555555555555',
    incidentDate,
    description: 'Burst pipe in the kitchen',
    claimAmount: 100,
    status: 'SUBMITTED',
    createdAt: '2026-10-02T09:00:00Z',
  });

describe('incident date display across time zones', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('shows the submitted incident date for a user east of UTC (Sydney)', () => {
    process.env.TZ = 'Australia/Sydney';
    const claim = summaryWithIncidentDate(INCIDENT_DATE);
    expect(formatDate(claim.incidentDate)).toBe(EXPECTED_LABEL);
  });

  it.fails('shows the submitted incident date for a user west of UTC (New York) - known defect', () => {
    process.env.TZ = 'America/New_York';
    const claim = summaryWithIncidentDate(INCIDENT_DATE);
    expect(formatDate(claim.incidentDate)).toBe(EXPECTED_LABEL);
  });
});
