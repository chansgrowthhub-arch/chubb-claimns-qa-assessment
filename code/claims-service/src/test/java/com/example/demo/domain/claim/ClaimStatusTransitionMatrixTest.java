package com.example.demo.domain.claim;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Full 5x5 transition matrix for the claim status state machine, driven from a single
 * expected-transitions table so every (from, to) pair is asserted exactly once.
 *
 * <p>The matrix below is the business rule as implemented and as mirrored by the frontend's
 * VALID_TRANSITIONS map (claim-status-transitions.ts). If either side changes, this test and
 * its frontend twin disagree loudly instead of drifting apart silently.</p>
 */
class ClaimStatusTransitionMatrixTest {

    private static final Map<ClaimStatus, Set<ClaimStatus>> EXPECTED_ALLOWED_TRANSITIONS = Map.of(
            ClaimStatus.SUBMITTED, EnumSet.of(ClaimStatus.UNDER_REVIEW, ClaimStatus.REJECTED),
            ClaimStatus.UNDER_REVIEW, EnumSet.of(ClaimStatus.APPROVED, ClaimStatus.REJECTED, ClaimStatus.SUBMITTED),
            ClaimStatus.APPROVED, EnumSet.of(ClaimStatus.CLOSED),
            ClaimStatus.REJECTED, EnumSet.of(ClaimStatus.CLOSED),
            ClaimStatus.CLOSED, EnumSet.noneOf(ClaimStatus.class)
    );

    static Stream<org.junit.jupiter.params.provider.Arguments> allStatusPairs() {
        return Stream.of(ClaimStatus.values())
                .flatMap(from -> Stream.of(ClaimStatus.values())
                        .map(to -> org.junit.jupiter.params.provider.Arguments.of(from, to)));
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @MethodSource("allStatusPairs")
    void transitionPermission_MatchesBusinessRuleMatrix(ClaimStatus from, ClaimStatus to) {
        boolean expected = EXPECTED_ALLOWED_TRANSITIONS.get(from).contains(to);

        assertThat(from.canTransitionTo(to))
                .as("Transition %s -> %s should be %s", from, to, expected ? "allowed" : "blocked")
                .isEqualTo(expected);
    }
}
