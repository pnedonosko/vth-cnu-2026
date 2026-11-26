package ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model;

import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.exception.DomainException;

public record PlayerPerformance(
    String playerId,
    int kills,
    int deaths,
    int assists,
    int combatScore,
    int deltaRR,
    String tierStatus
) {
    public PlayerPerformance {
        if (playerId == null || playerId.isBlank()) {
            throw new DomainException("INVALID_PLAYER_ID", "Player ID is required");
        }
        if (kills < 0 || deaths < 0 || assists < 0) {
            throw new DomainException("INVALID_KDA", "Kills, deaths, and assists cannot be negative");
        }
        if (combatScore < 0) {
            throw new DomainException("INVALID_COMBAT_SCORE", "Combat score cannot be negative");
        }
        if (tierStatus == null || tierStatus.isBlank()) {
            throw new DomainException("INVALID_TIER_STATUS", "Tier status is required");
        }
    }
}