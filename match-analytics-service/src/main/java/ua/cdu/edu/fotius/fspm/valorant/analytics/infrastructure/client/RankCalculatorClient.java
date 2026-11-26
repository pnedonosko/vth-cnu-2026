package ua.cdu.edu.fotius.fspm.valorant.analytics.infrastructure.client;

import io.micronaut.http.annotation.Body;
import io.micronaut.http.annotation.Post;
import io.micronaut.http.client.annotation.Client;
import io.micronaut.retry.annotation.Retryable;
import io.micronaut.serde.annotation.Serdeable;

@Client("${rank.calculator.url:`http://localhost:8082`}")
@Retryable(attempts = "3", delay = "1s", multiplier = "2.0")
public interface RankCalculatorClient {
    @Serdeable record RankCalculationRequest(boolean isWin, int roundMargin, int kills, int deaths, int assists, int combatScore, boolean isAfk) {}
    @Serdeable record RankCalculationResponse(int deltaRR, String tierStatus) {}

    @Post("/internal/v1/calculate-rating")
    RankCalculationResponse calculateRating(@Body RankCalculationRequest request);
}
