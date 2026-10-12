package com.example.demo.domain.claim;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Exact boundary-value tests for the Claim aggregate's validation rules.
 *
 * <p>The existing ClaimTest covers one happy and one sad value per rule; these tests pin the
 * exact edges (min-1 / min / max / max+1) where off-by-one regressions hide. All limits are
 * named constants so a rule change breaks exactly one line here.</p>
 */
class ClaimBoundaryTest {

    private static final UUID CLAIM_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final LocalDate VALID_DATE = LocalDate.now().minusDays(1);
    private static final String VALID_LOCATION = "123 Main Street, City";
    private static final String VALID_DESCRIPTION = "A description comfortably within limits";
    private static final BigDecimal VALID_AMOUNT = new BigDecimal("5000.00");

    private static final int DESCRIPTION_MIN = 10;
    private static final int DESCRIPTION_MAX = 1000;
    private static final int LOCATION_MIN = 5;
    private static final int LOCATION_MAX = 200;

    private static Claim claimWith(LocalDate date, String location, String description, BigDecimal amount) {
        return new Claim(CLAIM_ID, USER_ID, date, location, description, amount);
    }

    @Nested
    @DisplayName("Claim amount boundaries (0 < amount <= 1,000,000)")
    class AmountBoundaries {

        @Test
        void should_AcceptAmount_When_ExactlyAtMaximum() {
            Claim claim = claimWith(VALID_DATE, VALID_LOCATION, VALID_DESCRIPTION, Claim.MAX_CLAIM_AMOUNT);
            assertThat(claim.getClaimAmount()).isEqualByComparingTo(Claim.MAX_CLAIM_AMOUNT);
        }

        @Test
        void should_RejectAmount_When_OneCentAboveMaximum() {
            BigDecimal overMax = Claim.MAX_CLAIM_AMOUNT.add(new BigDecimal("0.01"));
            assertThatThrownBy(() -> claimWith(VALID_DATE, VALID_LOCATION, VALID_DESCRIPTION, overMax))
                    .isInstanceOf(InvalidClaimException.class);
        }

        @Test
        void should_RejectAmount_When_ExactlyZero() {
            assertThatThrownBy(() -> claimWith(VALID_DATE, VALID_LOCATION, VALID_DESCRIPTION, BigDecimal.ZERO))
                    .isInstanceOf(InvalidClaimException.class);
        }

        @Test
        void should_AcceptAmount_When_OneCent() {
            assertThatCode(() -> claimWith(VALID_DATE, VALID_LOCATION, VALID_DESCRIPTION, new BigDecimal("0.01")))
                    .doesNotThrowAnyException();
        }

        /**
         * Documents an inconsistency, not a desired rule: the HTTP contract enforces a floor of
         * 0.01 via bean validation, but the domain only requires amount > 0, so sub-cent amounts
         * pass if any non-HTTP path constructs a Claim. See TEST_STRATEGY.md §4-H.
         */
        @Test
        void should_AcceptSubCentAmount_DocumentingDomainVsApiFloorInconsistency() {
            assertThatCode(() -> claimWith(VALID_DATE, VALID_LOCATION, VALID_DESCRIPTION, new BigDecimal("0.001")))
                    .doesNotThrowAnyException();
        }
    }

    @Nested
    @DisplayName("Description boundaries (10-1000 chars after trimming)")
    class DescriptionBoundaries {

        @Test
        void should_AcceptDescription_When_ExactlyAtMinimumLength() {
            String minDescription = "a".repeat(DESCRIPTION_MIN);
            Claim claim = claimWith(VALID_DATE, VALID_LOCATION, minDescription, VALID_AMOUNT);
            assertThat(claim.getDescription()).hasSize(DESCRIPTION_MIN);
        }

        @Test
        void should_RejectDescription_When_OneCharBelowMinimum() {
            String tooShort = "a".repeat(DESCRIPTION_MIN - 1);
            assertThatThrownBy(() -> claimWith(VALID_DATE, VALID_LOCATION, tooShort, VALID_AMOUNT))
                    .isInstanceOf(InvalidClaimException.class);
        }

        @Test
        void should_AcceptDescription_When_ExactlyAtMaximumLength() {
            String maxDescription = "a".repeat(DESCRIPTION_MAX);
            Claim claim = claimWith(VALID_DATE, VALID_LOCATION, maxDescription, VALID_AMOUNT);
            assertThat(claim.getDescription()).hasSize(DESCRIPTION_MAX);
        }

        @Test
        void should_RejectDescription_When_OneCharAboveMaximum() {
            String tooLong = "a".repeat(DESCRIPTION_MAX + 1);
            assertThatThrownBy(() -> claimWith(VALID_DATE, VALID_LOCATION, tooLong, VALID_AMOUNT))
                    .isInstanceOf(InvalidClaimException.class);
        }

        @Test
        void should_RejectDescription_When_PaddingBringsItUnderMinimumAfterTrim() {
            String paddedUnderMin = "  " + "a".repeat(DESCRIPTION_MIN - 1) + "  ";
            assertThatThrownBy(() -> claimWith(VALID_DATE, VALID_LOCATION, paddedUnderMin, VALID_AMOUNT))
                    .isInstanceOf(InvalidClaimException.class);
        }
    }

    @Nested
    @DisplayName("Incident location boundaries (5-200 chars after trimming)")
    class LocationBoundaries {

        @Test
        void should_AcceptLocation_When_ExactlyAtMinimumLength() {
            String minLocation = "a".repeat(LOCATION_MIN);
            Claim claim = claimWith(VALID_DATE, minLocation, VALID_DESCRIPTION, VALID_AMOUNT);
            assertThat(claim.getIncidentLocation()).hasSize(LOCATION_MIN);
        }

        @Test
        void should_RejectLocation_When_OneCharBelowMinimum() {
            String tooShort = "a".repeat(LOCATION_MIN - 1);
            assertThatThrownBy(() -> claimWith(VALID_DATE, tooShort, VALID_DESCRIPTION, VALID_AMOUNT))
                    .isInstanceOf(InvalidClaimException.class);
        }

        @Test
        void should_AcceptLocation_When_ExactlyAtMaximumLength() {
            String maxLocation = "a".repeat(LOCATION_MAX);
            Claim claim = claimWith(VALID_DATE, maxLocation, VALID_DESCRIPTION, VALID_AMOUNT);
            assertThat(claim.getIncidentLocation()).hasSize(LOCATION_MAX);
        }

        @Test
        void should_RejectLocation_When_OneCharAboveMaximum() {
            String tooLong = "a".repeat(LOCATION_MAX + 1);
            assertThatThrownBy(() -> claimWith(VALID_DATE, tooLong, VALID_DESCRIPTION, VALID_AMOUNT))
                    .isInstanceOf(InvalidClaimException.class);
        }
    }

    @Nested
    @DisplayName("Incident date boundary (must not be in the future)")
    class IncidentDateBoundaries {

        @Test
        void should_AcceptIncidentDate_When_Today() {
            assertThatCode(() -> claimWith(LocalDate.now(), VALID_LOCATION, VALID_DESCRIPTION, VALID_AMOUNT))
                    .doesNotThrowAnyException();
        }

        @Test
        void should_RejectIncidentDate_When_Tomorrow() {
            assertThatThrownBy(() ->
                    claimWith(LocalDate.now().plusDays(1), VALID_LOCATION, VALID_DESCRIPTION, VALID_AMOUNT))
                    .isInstanceOf(InvalidClaimException.class);
        }
    }
}
