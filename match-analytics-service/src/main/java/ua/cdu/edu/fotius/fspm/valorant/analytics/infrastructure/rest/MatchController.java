package ua.cdu.edu.fotius.fspm.valorant.analytics.infrastructure.rest;

import io.micronaut.http.HttpRequest;
import io.micronaut.http.HttpResponse;
import io.micronaut.http.HttpStatus;
import io.micronaut.http.annotation.Body;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Error;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.Header;
import io.micronaut.http.annotation.Post;
import io.micronaut.http.exceptions.HttpStatusException;
import io.micronaut.scheduling.TaskExecutors;
import io.micronaut.scheduling.annotation.ExecuteOn;
import io.micronaut.serde.annotation.Serdeable;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import ua.cdu.edu.fotius.fspm.valorant.analytics.application.MatchApplicationService;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.exception.DomainException;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model.Match;

@Controller("/api/v1/matches")
public class MatchController {

    private static final Logger log = LoggerFactory.getLogger(MatchController.class);

    private final MatchApplicationService matchService;

    @Inject
    public MatchController(MatchApplicationService matchService) {
        this.matchService = matchService;
    }

    @Serdeable public record MatchSubmissionRequest(String rosterId, String playerId, String mapName, boolean isWin, int roundMargin, int kills, int deaths, int assists, int combatScore, boolean isAfk) {}
    @Serdeable public record MatchSubmissionResponse(String matchId, int deltaRR, String tierStatus) {}
    @Serdeable public record MatchHistoryItemDto(String matchId, String mapName, String result, int deltaRR, String tierStatus) {}
    @Serdeable public record ErrorDto(String code, String message) {}

    @ExecuteOn(TaskExecutors.BLOCKING)
    @Post("/submit")
    public MatchSubmissionResponse submitMatch(@Body MatchSubmissionRequest request,
                                               @Header("Authorization") Optional<String> authHeader) {
        log.info("POST /matches/submit - rosterId={}, playerId={}, map={}",
            request.rosterId(), request.playerId(), request.mapName());

        String token = authHeader
            .filter(h -> !h.isBlank() && h.startsWith("Bearer "))
            .orElseThrow(() -> new HttpStatusException(HttpStatus.UNAUTHORIZED, "Missing or invalid Bearer token"));

        Match recorded = matchService.submitMatch(new MatchApplicationService.SubmitMatchCommand(
            request.rosterId(),
            request.playerId(),
            request.mapName(),
            request.isWin(),
            request.roundMargin(),
            request.kills(),
            request.deaths(),
            request.assists(),
            request.combatScore(),
            request.isAfk(),
            token
        ));

        return new MatchSubmissionResponse(
            recorded.getId().value(),
            recorded.getPerformance().deltaRR(),
            recorded.getPerformance().tierStatus()
        );
    }

    @Get("/history/{playerId}")
    public HttpResponse<List<MatchHistoryItemDto>> getMatchHistory(String playerId) {
        log.info("GET /matches/history/{}", playerId);
        List<MatchHistoryItemDto> history = matchService.getMatchHistory(playerId).stream()
            .map(row -> new MatchHistoryItemDto(
                row.matchId(),
                row.mapName(),
                row.result(),
                row.deltaRR(),
                row.tierStatus()
            ))
            .toList();
        return HttpResponse.ok(history);
    }

    @Error(exception = DomainException.class)
    public HttpResponse<ErrorDto> handleDomainError(HttpRequest<?> request, DomainException ex) {
        HttpStatus status = switch (ex.getCode()) {
            case "ROSTER_ALREADY_ARCHIVED" -> HttpStatus.CONFLICT;
            case "PERSISTENCE_FAILED" -> HttpStatus.INTERNAL_SERVER_ERROR;
            default -> HttpStatus.BAD_REQUEST;
        };
        log.warn("Domain error ({}): {} - {}", status.getCode(), ex.getCode(), ex.getMessage());
        return HttpResponse.status(status).body(new ErrorDto(ex.getCode(), ex.getMessage()));
    }
}