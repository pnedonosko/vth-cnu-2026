package ua.cdu.edu.fotius.fspm.valorant.analytics.infrastructure.persistence;

import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import java.util.List;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model.Match;
import ua.cdu.edu.fotius.fspm.valorant.analytics.domain.model.PlayerPerformance;

@Singleton
public class MatchRepository {

    public record MatchHistoryRow(String matchId, String mapName, String result, int deltaRR, String tierStatus) {}

    private final Jdbi jdbi;

    @Inject
    public MatchRepository(Jdbi jdbi) {
        this.jdbi = jdbi;
    }

    public void save(Match match) {
        PlayerPerformance perf = match.getPerformance();
        jdbi.useTransaction(handle -> {
            handle.createUpdate(
                    "INSERT INTO matches (id, roster_id, map_name, result, round_margin) " +
                    "VALUES (:id, :rid, :map, :res, :margin)")
                .bind("id", match.getId().value())
                .bind("rid", match.getRosterId())
                .bind("map", match.getMapName())
                .bind("res", match.getResult().name())
                .bind("margin", match.getRoundMargin())
                .execute();

            handle.createUpdate(
                    "INSERT INTO match_players (id, match_id, player_id, kills, deaths, assists, combat_score, delta_rr, tier_status) " +
                    "VALUES (:id, :mid, :pid, :k, :d, :a, :score, :rr, :tier)")
                .bind("id", UUID.randomUUID().toString())
                .bind("mid", match.getId().value())
                .bind("pid", perf.playerId())
                .bind("k", perf.kills())
                .bind("d", perf.deaths())
                .bind("a", perf.assists())
                .bind("score", perf.combatScore())
                .bind("rr", perf.deltaRR())
                .bind("tier", perf.tierStatus())
                .execute();
        });
    }

    public List<MatchHistoryRow> findHistoryByPlayerId(String playerId) {
        return jdbi.withHandle(handle ->
            handle.createQuery(
                    "SELECT m.id, m.map_name, m.result, mp.delta_rr, mp.tier_status " +
                    "FROM matches m JOIN match_players mp ON m.id = mp.match_id " +
                    "WHERE mp.player_id = :pid ORDER BY m.played_at DESC")
                .bind("pid", playerId)
                .map((rs, ctx) -> new MatchHistoryRow(
                    rs.getString("id"),
                    rs.getString("map_name"),
                    rs.getString("result"),
                    rs.getInt("delta_rr"),
                    rs.getString("tier_status")
                ))
                .list()
        );
    }
}