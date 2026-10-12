package com.example.demo.adapter.in.messaging;

import com.example.demo.adapter.in.websocket.ClaimWebSocketHandler;
import com.example.demo.adapter.in.websocket.WebSocketMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * Content-level tests for the Kafka -> WebSocket bridge.
 *
 * <p>The existing ClaimEventKafkaConsumerTest only verifies that *a* broadcast happened. That is
 * exactly how the CDC field-name defect (consumer reads {@code claim_id}, documented schema and
 * TestEventController emit {@code id}) went unnoticed: a broadcast with an empty claimId still
 * counts as "a broadcast". These tests capture the outgoing WebSocketMessage and assert its
 * fields, so a payload-contract drift fails loudly.</p>
 *
 * <p>The test tagged {@code defect} encodes the behaviour the committed AsyncAPI schema
 * (DebeziumClaimsMessage.json) promises, and FAILS against current code. It is excluded from the
 * default run (surefire excludedGroups) and run explicitly with {@code mvn test -Dgroups=defect}.
 * See TEST_STRATEGY.md section 4-B.</p>
 */
class ClaimEventKafkaConsumerContentTest {

    private static final String CLAIM_ID = "d4e5f6a7-b8c9-0123-4567-89abcdef0123";
    private static final String USER_ID = "f6a7b8c9-d0e1-2345-6789-abcdef012345";
    private static final long CDC_TIMESTAMP_MS = 1709625600000L;

    private ClaimWebSocketHandler webSocketHandler;
    private ClaimEventKafkaConsumer consumer;

    @BeforeEach
    void setUp() {
        webSocketHandler = mock(ClaimWebSocketHandler.class);
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        consumer = new ClaimEventKafkaConsumer(webSocketHandler, objectMapper);
    }

    @Test
    void should_BroadcastFullStatusChangeDetails_When_DomainEventReceived() {
        String message = """
                {
                    "eventId": "evt-456",
                    "eventType": "claim-status-changed",
                    "payload": {
                        "claimId": "%s",
                        "userId": "%s",
                        "oldStatus": "SUBMITTED",
                        "newStatus": "APPROVED",
                        "correlationId": "corr-789"
                    }
                }
                """.formatted(CLAIM_ID, USER_ID);

        consumer.consumeDomainEvent(message);

        ArgumentCaptor<WebSocketMessage> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(webSocketHandler).broadcastToUserAndAdmins(eq(USER_ID), captor.capture());

        WebSocketMessage sent = captor.getValue();
        assertThat(sent.type()).isEqualTo("CLAIM_STATUS_CHANGED");
        assertThat(sent.claimId()).isEqualTo(CLAIM_ID);
        assertThat(sent.oldStatus()).isEqualTo("SUBMITTED");
        assertThat(sent.newStatus()).isEqualTo("APPROVED");
        assertThat(sent.correlationId()).isEqualTo("corr-789");
    }

    @Test
    void should_FallBackToEventIdAsCorrelationId_When_PayloadHasNoCorrelationId() {
        String message = """
                {
                    "eventId": "evt-fallback-id",
                    "eventType": "claim-submitted",
                    "payload": { "claimId": "%s", "userId": "%s" }
                }
                """.formatted(CLAIM_ID, USER_ID);

        consumer.consumeDomainEvent(message);

        ArgumentCaptor<WebSocketMessage> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(webSocketHandler).broadcastToAdmins(captor.capture());

        assertThat(captor.getValue().correlationId()).isEqualTo("evt-fallback-id");
        assertThat(captor.getValue().claimId()).isEqualTo(CLAIM_ID);
    }

    @Test
    void should_BroadcastClaimIdAndStatuses_When_CdcUpdateUsesRealDebeziumColumnNames() {
        // Real Debezium pgoutput emits the actual Postgres column names: claim_id, user_id, status.
        String message = """
                {
                    "op": "u",
                    "before": { "claim_id": "%s", "status": "SUBMITTED", "user_id": "%s" },
                    "after":  { "claim_id": "%s", "status": "UNDER_REVIEW", "user_id": "%s" },
                    "ts_ms": %d
                }
                """.formatted(CLAIM_ID, USER_ID, CLAIM_ID, USER_ID, CDC_TIMESTAMP_MS);

        consumer.consumeCdcEvent(message);

        ArgumentCaptor<WebSocketMessage> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(webSocketHandler).broadcastToUserAndAdmins(eq(USER_ID), captor.capture());

        WebSocketMessage sent = captor.getValue();
        assertThat(sent.claimId()).isEqualTo(CLAIM_ID);
        assertThat(sent.oldStatus()).isEqualTo("SUBMITTED");
        assertThat(sent.newStatus()).isEqualTo("UNDER_REVIEW");
        assertThat(sent.timestamp()).isEqualTo(Instant.ofEpochMilli(CDC_TIMESTAMP_MS));
    }

    /**
     * DEFECT (fails by design against current code): the committed AsyncAPI schema and the
     * claims-service TestEventController both use the field name {@code id}, but the consumer
     * reads {@code claim_id}. Every mock CDC event injected for deterministic E2E testing is
     * therefore broadcast with an empty claimId and the UI updates nothing.
     * Run with: mvn test -Dgroups=defect
     */
    @Test
    @Tag("defect")
    void should_BroadcastClaimId_When_CdcPayloadMatchesCommittedAsyncApiSchema() {
        String messagePerDocumentedSchema = """
                {
                    "op": "u",
                    "before": { "id": "%s", "status": "SUBMITTED", "user_id": "%s" },
                    "after":  { "id": "%s", "status": "APPROVED", "user_id": "%s" },
                    "ts_ms": %d
                }
                """.formatted(CLAIM_ID, USER_ID, CLAIM_ID, USER_ID, CDC_TIMESTAMP_MS);

        consumer.consumeCdcEvent(messagePerDocumentedSchema);

        ArgumentCaptor<WebSocketMessage> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(webSocketHandler).broadcastToUserAndAdmins(eq(USER_ID), captor.capture());

        assertThat(captor.getValue().claimId())
                .as("claimId must survive a schema-conformant CDC payload (currently arrives empty)")
                .isEqualTo(CLAIM_ID);
    }
}
