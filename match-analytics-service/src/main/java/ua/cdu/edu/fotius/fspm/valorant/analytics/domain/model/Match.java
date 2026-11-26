package ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model;

import java.util.Objects;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.exception.DomainException;

public class Match {
    private final MatchId id;
    private final String rosterId;
    private final String mapName;
    private final MatchResult result;
    private final int roundMargin;
    private final PlayerPerformance performance;

    public Match(MatchId id, String rosterId, String mapName, MatchResult result, int roundMargin, PlayerPerformance performance) {
        if (rosterId == null || rosterId.isBlank()) {
            throw new DomainException("INVALID_ROSTER_ID", "Roster ID is required");
        }
        if (mapName == null || mapName.isBlank()) {
            throw new DomainException("INVALID_MAP_NAME", "Map name is required");
        }
        if (roundMargin < 0) {
            throw new DomainException("INVALID_ROUND_MARGIN", "Round margin cannot be negative");
        }
        this.id = Objects.requireNonNull(id, "MatchId cannot be null");
        this.rosterId = rosterId.trim();
        this.mapName = mapName.trim();
        this.result = Objects.requireNonNull(result, "MatchResult cannot be null");
        this.roundMargin = roundMargin;
        this.performance = Objects.requireNonNull(performance, "PlayerPerformance cannot be null");
    }

    public static Match record(String rosterId, String mapName, boolean isWin, int roundMargin, PlayerPerformance performance) {
        return new Match(
            MatchId.generate(),
            rosterId,
            mapName,
            MatchResult.fromWinFlag(isWin),
            roundMargin,
            performance
        );
    }

    public MatchId getId() { return id; }
    public String getRosterId() { return rosterId; }
    public String getMapName() { return mapName; }
    public MatchResult getResult() { return result; }
    public int getRoundMargin() { return roundMargin; }
    public PlayerPerformance getPerformance() { return performance; }
}