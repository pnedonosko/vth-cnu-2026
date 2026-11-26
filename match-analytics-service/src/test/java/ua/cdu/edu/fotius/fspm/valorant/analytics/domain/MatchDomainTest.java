package ua.cdu.edu.fotius.fspm.valorant.analytics.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.exception.DomainException;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model.Match;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model.MatchResult;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model.PlayerPerformance;

import static org.junit.jupiter.api.Assertions.*;

class MatchDomainTest {

    @Test
    @DisplayName("GIVEN valid match data WHEN recorded THEN creates Match aggregate with WIN result")
    void shouldCreateValidMatchAggregate() {
        var perf = new PlayerPerformance("p-001", 22, 12, 5, 310, 25, "PROMOTED");
        var match = Match.record("r-101", "Ascent", true, 5, perf);

        assertNotNull(match.getId());
        assertEquals("r-101", match.getRosterId());
        assertEquals("Ascent", match.getMapName());
        assertEquals(MatchResult.WIN, match.getResult());
        assertEquals(5, match.getRoundMargin());
        assertEquals(25, match.getPerformance().deltaRR());
    }

    @Test
    @DisplayName("GIVEN negative round margin WHEN recorded THEN throws DomainException")
    void shouldRejectNegativeRoundMargin() {
        var perf = new PlayerPerformance("p-001", 10, 15, 3, 180, -18, "DEMOTED");
        DomainException ex = assertThrows(DomainException.class,
            () -> Match.record("r-101", "Ascent", false, -3, perf));

        assertEquals("INVALID_ROUND_MARGIN", ex.getCode());
    }

    @Test
    @DisplayName("GIVEN negative KDA stats WHEN creating PlayerPerformance THEN throws DomainException")
    void shouldRejectNegativeKdaStats() {
        DomainException ex = assertThrows(DomainException.class,
            () -> new PlayerPerformance("p-001", -1, 10, 2, 150, -15, "MAINTAINED"));

        assertEquals("INVALID_KDA", ex.getCode());
    }

    @Test
    @DisplayName("GIVEN blank map name WHEN recorded THEN throws DomainException")
    void shouldRejectBlankMapName() {
        var perf = new PlayerPerformance("p-001", 15, 10, 4, 220, 18, "MAINTAINED");
        DomainException ex = assertThrows(DomainException.class,
            () -> Match.record("r-101", "   ", true, 2, perf));

        assertEquals("INVALID_MAP_NAME", ex.getCode());
    }
}