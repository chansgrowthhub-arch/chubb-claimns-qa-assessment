package com.example.demo.adapter.out.messaging;

import com.example.demo.domain.claim.ClaimStatus;
import com.example.demo.domain.claim.events.ClaimStatusChanged;
import com.example.demo.domain.claim.events.ClaimSubmitted;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Tests for the Kafka envelope the BFF consumer actually depends on.
 *
 * <p>Rewritten: the shipped version of this class mocked ObjectMapper#writeValueAsString(event),
 * but the production code was changed to build an {@code {eventType, eventId, payload}} envelope
 * via {@code objectMapper.createObjectNode()}. Against current code the old tests NPE'd
 * (createObjectNode on a mock returns null) - evidence they were stale and not run in CI.
 * This version uses a real ObjectMapper and asserts the envelope CONTENT, i.e. the de-facto
 * Kafka contract between claims-service and the BFF's ClaimEventKafkaConsumer.</p>
 */
@ExtendWith(MockitoExtension.class)
class KafkaDomainEventPublisherTest {

    private static final String TOPIC = "claim-events";

    @Mock
    private KafkaTemplate<String, String> kafkaTemplate;

    @Mock
    private KafkaMessageSchemaValidator schemaValidator;

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    private KafkaDomainEventPublisher publisher;

    @BeforeEach
    void setUp() {
        publisher = new KafkaDomainEventPublisher(kafkaTemplate, objectMapper, schemaValidator);
        lenient().when(kafkaTemplate.send(anyString(), anyString(), anyString()))
                .thenReturn(CompletableFuture.completedFuture(null));
    }

    // TC-077: ClaimSubmitted published with claimId key and the envelope the BFF consumer parses
    @Test
    void should_PublishEnvelopeWithSubmittedPayload_When_ClaimSubmittedEventProvided() throws Exception {
        UUID claimId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String eventId = UUID.randomUUID().toString();
        var event = new ClaimSubmitted(eventId, claimId, userId, LocalDate.now(), BigDecimal.TEN, Instant.now());

        publisher.publish(event);

        JsonNode envelope = capturePublishedEnvelope(claimId);
        assertThat(envelope.path("eventType").asText()).isEqualTo("claim-submitted");
        assertThat(envelope.path("eventId").asText()).isEqualTo(eventId);
        assertThat(envelope.path("payload").path("claimId").asText()).isEqualTo(claimId.toString());
        assertThat(envelope.path("payload").path("userId").asText()).isEqualTo(userId.toString());
        assertThat(envelope.path("payload").path("correlationId").asText()).isEqualTo(eventId);
    }

    // TC-077b: ClaimStatusChanged envelope carries both statuses and the notification target userId
    @Test
    void should_PublishEnvelopeWithStatusChangePayload_When_ClaimStatusChangedEventProvided() throws Exception {
        UUID claimId = UUID.randomUUID();
        UUID changedBy = UUID.randomUUID();
        String eventId = UUID.randomUUID().toString();
        var event = new ClaimStatusChanged(eventId, claimId,
                ClaimStatus.SUBMITTED, ClaimStatus.UNDER_REVIEW, changedBy, Instant.now());

        publisher.publish(event);

        JsonNode envelope = capturePublishedEnvelope(claimId);
        assertThat(envelope.path("eventType").asText()).isEqualTo("claim-status-changed");
        assertThat(envelope.path("payload").path("oldStatus").asText()).isEqualTo("SUBMITTED");
        assertThat(envelope.path("payload").path("newStatus").asText()).isEqualTo("UNDER_REVIEW");
        assertThat(envelope.path("payload").path("userId").asText()).isEqualTo(changedBy.toString());
    }

    // TC-078: schema validation runs against the serialized envelope before sending
    @Test
    void should_ValidateSerializedEnvelopeAgainstSchema_BeforeSending() {
        var event = submittedEvent();

        publisher.publish(event);

        ArgumentCaptor<String> validatedPayload = ArgumentCaptor.forClass(String.class);
        verify(schemaValidator).validate(validatedPayload.capture(), eq("ClaimSubmittedMessage"));
        ArgumentCaptor<String> sentPayload = ArgumentCaptor.forClass(String.class);
        verify(kafkaTemplate).send(eq(TOPIC), anyString(), sentPayload.capture());
        assertThat(validatedPayload.getValue()).isEqualTo(sentPayload.getValue());
    }

    // TC-079: serialization failure surfaces as IllegalStateException
    @Test
    void should_ThrowIllegalStateException_When_SerializationFails() throws JsonProcessingException {
        ObjectMapper failingMapper = spy(new ObjectMapper().findAndRegisterModules());
        doThrow(new JsonProcessingException("boom") { }).when(failingMapper).writeValueAsString(any());
        KafkaDomainEventPublisher failingPublisher =
                new KafkaDomainEventPublisher(kafkaTemplate, failingMapper, schemaValidator);

        assertThatThrownBy(() -> failingPublisher.publish(submittedEvent()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Failed to serialize domain event");
        verifyNoInteractions(kafkaTemplate);
    }

    // TC-NEW-002: validator rejection aborts the publish (nothing reaches Kafka)
    @Test
    void should_PropagateValidationExceptionAndSkipSend_When_ValidatorRejectsPayload() {
        doThrow(new KafkaMessageValidationException("claimId: is missing but it is required"))
                .when(schemaValidator).validate(anyString(), eq("ClaimSubmittedMessage"));

        assertThatThrownBy(() -> publisher.publish(submittedEvent()))
                .isInstanceOf(KafkaMessageValidationException.class)
                .hasMessageContaining("claimId");
        verifyNoInteractions(kafkaTemplate);
    }

    // TC-NEW-003: same guarantee for the status-changed schema
    @Test
    void should_PropagateValidationExceptionAndSkipSend_When_StatusChangeSchemaRejected() {
        doThrow(new KafkaMessageValidationException("oldStatus: does not have a value in the enumeration"))
                .when(schemaValidator).validate(anyString(), eq("ClaimStatusChangedMessage"));

        var event = new ClaimStatusChanged(UUID.randomUUID().toString(), UUID.randomUUID(),
                ClaimStatus.SUBMITTED, ClaimStatus.UNDER_REVIEW, UUID.randomUUID(), Instant.now());

        assertThatThrownBy(() -> publisher.publish(event))
                .isInstanceOf(KafkaMessageValidationException.class)
                .hasMessageContaining("oldStatus");
        verifyNoInteractions(kafkaTemplate);
    }

    private ClaimSubmitted submittedEvent() {
        return new ClaimSubmitted(UUID.randomUUID().toString(), UUID.randomUUID(), UUID.randomUUID(),
                LocalDate.now(), BigDecimal.TEN, Instant.now());
    }

    private JsonNode capturePublishedEnvelope(UUID expectedKey) throws Exception {
        ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);
        verify(kafkaTemplate).send(eq(TOPIC), eq(expectedKey.toString()), payloadCaptor.capture());
        return objectMapper.readTree(payloadCaptor.getValue());
    }
}
