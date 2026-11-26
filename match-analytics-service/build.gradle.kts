dependencies {
    annotationProcessor("io.micronaut:micronaut-inject-java")
    annotationProcessor("io.micronaut.serde:micronaut-serde-processor")
    implementation("io.micronaut.serde:micronaut-serde-jackson")
    implementation("io.micronaut.flyway:micronaut-flyway")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("io.micronaut.sql:micronaut-jdbi")
    implementation("io.micronaut:micronaut-http-client")
    implementation("io.micronaut:micronaut-retry")
    runtimeOnly("io.micronaut.sql:micronaut-jdbc-hikari")
    runtimeOnly("org.postgresql:postgresql")
    runtimeOnly("ch.qos.logback:logback-classic")

    testImplementation("io.micronaut.test:micronaut-test-junit5")
    testImplementation("org.junit.jupiter:junit-jupiter-api")
    testRuntimeOnly("org.junit.jupiter:junit-jupiter-engine")
    testImplementation("org.mockito:mockito-core:5.11.0")
}

application {
    mainClass.set("ua.cdu.edu.fotius.fspm.valorant.analytics.Application")
}
