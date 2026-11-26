pluginManagement {
    plugins {
        id("io.micronaut.application") version "5.0.2"
        id("io.micronaut.test-resources") version "5.0.2"
        id("com.google.cloud.tools.jib") version "3.5.4"
    }
}

rootProject.name = "valorant-tactical-hub"
include("roster-service", "match-analytics-service", "rank-calculator-service")
