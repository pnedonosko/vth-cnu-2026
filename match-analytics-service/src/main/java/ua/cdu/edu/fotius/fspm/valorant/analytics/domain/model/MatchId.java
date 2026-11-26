package ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model;

import java.util.UUID;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.exception.DomainException;

public record MatchId(String value) {
    public MatchId {
        if (value == null || value.isBlank()) {
            throw new DomainException("INVALID_MATCH_ID", "MatchId cannot be null or blank");
        }
    }

    public static MatchId generate() {
        return new MatchId(UUID.randomUUID().toString());
    }
}