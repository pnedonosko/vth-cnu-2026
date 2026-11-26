package ua.cdu.edu.fotius.fspm.valorant.analytics.infrastructure.client;

import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.Header;
import io.micronaut.http.annotation.PathVariable;
import io.micronaut.http.annotation.Post;
import io.micronaut.http.client.annotation.Client;
import io.micronaut.retry.annotation.Retryable;
import io.micronaut.serde.annotation.Serdeable;

@Client("${roster.service.url:`http://localhost:8080`}")
@Retryable(attempts = "3", delay = "1s", multiplier = "2.0")
public interface RosterServiceClient {
    @Serdeable
    record RosterResponse(String id, String captainId, String mapName, String status, Object members, Object _links) {}

    @Get("/api/v1/rosters/{id}")
    RosterResponse getRoster(@PathVariable String id, @Header("Authorization") String authHeader);

    @Post("/api/v1/rosters/{id}/archive")
    void archiveRoster(@PathVariable String id, @Header("Authorization") String authHeader);

    @Post("/api/v1/rosters/{id}/unarchive")
    void unarchiveRoster(@PathVariable String id, @Header("Authorization") String authHeader);
}
