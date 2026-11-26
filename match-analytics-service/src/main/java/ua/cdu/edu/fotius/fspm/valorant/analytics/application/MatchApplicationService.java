package ua.cdu.edu.fotius.fspm.valorant.analytics.application;

import io.micronaut.http.client.exceptions.HttpClientResponseException;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.exception.DomainException;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model.Match;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model.PlayerPerformance;
import ua.cdu.edu.fotius.fspm.valorant.analytics.infrastructure.client.RankCalculatorClient;
import ua.cdu.edu.fotius.fspm.valorant.analytics.infrastructure.client.RosterServiceClient;
import ua.cdu.edu.fotius.fspm.valorant.analytics.infrastructure.persistence.MatchRepository;

@Singleton
public class MatchApplicationService {

    private static final Logger log = LoggerFactory.getLogger(MatchApplicationService.class);

    public record SubmitMatchCommand(
        String rosterId,
        String playerId,
        String mapName,
        boolean isWin,
        int roundMargin,
        int kills,
        int deaths,
        int assists,
        int combatScore,
        boolean isAfk,
        String bearerToken
    ) {}

    private final MatchRepository matchRepository;
    private final RankCalculatorClient rankClient;
    private final RosterServiceClient rosterClient;

    @Inject
    public MatchApplicationService(MatchRepository matchRepository,
                                   RankCalculatorClient rankClient,
                                   RosterServiceClient rosterClient) {
        this.matchRepository = matchRepository;
        this.rankClient = rankClient;
        this.rosterClient = rosterClient;
    }

    public Match submitMatch(SubmitMatchCommand cmd) {
        // 1. Fail-fast verification of roster status
        verifyRosterLocked(cmd.rosterId(), cmd.bearerToken());

        // 2. Calculate rating via Rank Calculator context
        var rankRes = rankClient.calculateRating(new RankCalculatorClient.RankCalculationRequest(
            cmd.isWin(), cmd.roundMargin(), cmd.kills(),
            cmd.deaths(), cmd.assists(), cmd.combatScore(), cmd.isAfk()
        ));
        log.info("Rank calculated for roster {}: deltaRR={}, tierStatus={}",
            cmd.rosterId(), rankRes.deltaRR(), rankRes.tierStatus());

        // 3. Build domain aggregate & validate invariants before side effects
        PlayerPerformance performance = new PlayerPerformance(
            cmd.playerId(), cmd.kills(), cmd.deaths(), cmd.assists(),
            cmd.combatScore(), rankRes.deltaRR(), rankRes.tierStatus()
        );
        Match match = Match.record(cmd.rosterId(), cmd.mapName(), cmd.isWin(), cmd.roundMargin(), performance);

        // 4. Archive roster FIRST (outside DB transaction)
        archiveRoster(cmd.rosterId(), cmd.bearerToken());

        // 5. Persist match in DB transaction with Saga compensation
        try {
            matchRepository.save(match);
            log.info("Match recorded: matchId={}", match.getId().value());
            return match;
        } catch (Exception e) {
            compensateUnarchive(cmd.rosterId(), cmd.bearerToken());
            throw new DomainException("PERSISTENCE_FAILED", "Failed to persist match: " + e.getMessage());
        }
    }

    public List<MatchRepository.MatchHistoryRow> getMatchHistory(String playerId) {
        return matchRepository.findHistoryByPlayerId(playerId);
    }

    private void verifyRosterLocked(String rosterId, String token) {
        try {
            var roster = rosterClient.getRoster(rosterId, token);
            if ("ARCHIVED".equals(roster.status())) {
                throw new DomainException("ROSTER_ALREADY_ARCHIVED", "Match already submitted for roster " + rosterId);
            }
            if (!"LOCKED".equals(roster.status())) {
                throw new DomainException("ROSTER_NOT_LOCKED",
                    "Roster must be LOCKED before match submission (current status: " + roster.status() + ")");
            }
        } catch (DomainException e) {
            throw e;
        } catch (HttpClientResponseException e) {
            if (e.getStatus().getCode() == 404) {
                throw new DomainException("ROSTER_NOT_FOUND", "Roster not found for roster " + rosterId);
            }
            throw new DomainException("ROSTER_VERIFICATION_FAILED",
                "Could not verify roster status for roster " + rosterId + ": " + e.getMessage());
        } catch (Exception e) {
            throw new DomainException("ROSTER_VERIFICATION_FAILED",
                "Could not verify roster status for roster " + rosterId + ": " + e.getMessage());
        }
    }

    private void archiveRoster(String rosterId, String token) {
        try {
            rosterClient.archiveRoster(rosterId, token);
            log.info("Roster {} archived", rosterId);
        } catch (HttpClientResponseException e) {
            if (e.getStatus().getCode() == 409) {
                throw new DomainException("ROSTER_ALREADY_ARCHIVED", "Match already submitted for roster " + rosterId);
            }
            throw new DomainException("ARCHIVE_FAILED", "Failed to archive roster " + rosterId + ": " + e.getMessage());
        } catch (Exception e) {
            throw new DomainException("ARCHIVE_FAILED", "Failed to archive roster " + rosterId + ": " + e.getMessage());
        }
    }

    private void compensateUnarchive(String rosterId, String token) {
        try {
            rosterClient.unarchiveRoster(rosterId, token);
            log.info("Compensated: roster {} unarchived", rosterId);
        } catch (Exception ignored) {
            log.warn("Compensation failed for roster {}: {}", rosterId, ignored.getMessage());
        }
    }
}