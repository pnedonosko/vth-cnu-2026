# GCP Cloud Run + Neon + Firebase Deployment Design (`vth-cnu-2026`)

## 1. Architectural Overview & Goals

This document specifies the cloud deployment architecture and implementation plan for **Valorant Tactical Hub (`vth-cnu-2026`)** targeting **Google Cloud Run** (3 Micronaut 5 microservices), **Neon PostgreSQL** (serverless managed database), and **Firebase Hosting** (Vite SPA frontend).

### Core Design Principles
1. **Single Project Config (`.env.cloud`):** Students configure exactly **one** gitignored file at the repository root (`.env.cloud`, copied from `.env.cloud.example`) containing 5 variables (`GCP_PROJECT_ID`, `GCP_REGION`, `JDBC_DATABASE_URL`, `DB_USER`, `DB_PASSWORD`). No manual editing of `.yml`, `.kts`, or `.json` files is required.
2. **Two-Phase Cloud Run Deployment (Resolving `roster-service` <-> `match-analytics-service`):** Because Cloud Run assigns dynamic `*.run.app` URLs upon service creation, services are deployed bottom-up (`rank-calculator-service` -> `roster-service` -> `match-analytics-service`), followed by a fast Phase-2 wiring step (`gcloud run services update roster-service`) to inject `ANALYTICS_SERVICE_URL`.
3. **Graceful Tolerance & Zero Hardcoded Localhost in Cloud:** `roster-service` tolerates a missing `ANALYTICS_SERVICE_URL` on initial boot by omitting `_links.submit_match` until Phase-2 wiring completes—preserving strict HATEOAS semantics without crashing or leaking `localhost` URLs into cloud responses.
4. **Build-Time Injection for Firebase Frontend (No `.firebaserc` Required):** `Makefile` captures the live Cloud Run URLs from `gcloud run services describe` and passes them directly as environment variables (`VITE_ROSTER_SERVICE_URL`, `VITE_ANALYTICS_SERVICE_URL`) into `vite build --mode cloud`, then deploys using `firebase deploy --only hosting --project $(GCP_PROJECT_ID)`.
5. **Cold-Start Mitigation (`min-instances=0` Friendly):** Combines Cloud Run `--cpu-boost`, Micronaut HTTP client `@Retryable` + extended `read-timeout`, and silent frontend `/health` pre-warming on page load so scale-from-zero wakeups remain smooth and free-tier safe.

---

## 2. Deployment Sequence (Bottom-Up + Two-Phase Wiring)

```text
[1] Neon PostgreSQL (External Managed DB)
         |
         v
[2] rank-calculator-service  --> outputs RANK_URL (stateless / DB-only)
         |
         v
[3] roster-service (Phase 1) --> outputs ROSTER_URL (boots without ANALYTICS_SERVICE_URL)
         |
         v
[4] match-analytics-service  --> receives ROSTER_URL & RANK_URL; outputs ANALYTICS_URL
         |
         v
[5] roster-service (Phase 2) --> gcloud run services update --update-env-vars ANALYTICS_SERVICE_URL
         |
         v
[6] Frontend (Vite + Firebase) > receives VITE_ROSTER_SERVICE_URL & VITE_ANALYTICS_SERVICE_URL at build time
```

---

## 3. Required Codebase Changes (Instructions for `agy` CLI)

Apply the following targeted changes across the repository (reference templates are also included inside `patch/` in this archive).

### 3.1 Root `build.gradle.kts` — Pin Jib Base Image Platform to `linux/amd64`
**Why:** Students or instructors on Apple Silicon (`arm64`) will otherwise push ARM64 container manifests that Cloud Run (`x86_64` / `linux/amd64`) rejects on deploy.
* **Target:** `build.gradle.kts` inside `jib { from { ... } }`
* **Change:**
  ```kotlin
  jib {
      from {
          image = "eclipse-temurin:25-jre-alpine"
          platforms {
              platform {
                  architecture = "amd64"
                  os = "linux"
              }
          }
      }
      container {
          ports = listOf("8080")
          jvmFlags = listOf(
              "-Xms64m",
              "-Xmx256m",
              "-XX:+UseSerialGC"
          )
          environment = mapOf(
              "VTH_ENVIRONMENT" to "cloud"
          )
      }
  }
  ```

### 3.2 Datasource Bindings in `application-cloud.yml`
**Why:** When `VTH_ENVIRONMENT=cloud`, Micronaut loads `application.yml` + `application-cloud.yml` (skipping `application-dev.yml`). Currently `url`, `username`, and `password` under `datasources.default` only exist in `application-dev.yml`, causing HikariCP startup failure in Cloud Run.
* **Targets:**
  * `roster-service/src/main/resources/application-cloud.yml`
  * `match-analytics-service/src/main/resources/application-cloud.yml`
  * *(Verify `rank-calculator-service/src/main/resources/application-cloud.yml` as well if it uses a datasource)*
* **Change:** Ensure `datasources.default` explicitly binds environment variables (with no localhost fallback in cloud profile):
  ```yaml
  datasources:
    default:
      url: ${JDBC_DATABASE_URL}
      username: ${DB_USER}
      password: ${DB_PASSWORD}
      driver-class-name: org.postgresql.Driver
      maximum-pool-size: 5
      minimum-idle: 1
      connection-timeout: 15000
  ```

### 3.3 `RosterController.java` — Environment-Driven & Tolerant `_links.submit_match`
**Why:** Hardcoding `http://localhost:8081/api/v1/matches/submit` breaks browser requests from Firebase Hosting (`*.web.app`). Furthermore, during Phase 1 of Cloud Run deploy, `ANALYTICS_SERVICE_URL` is not yet set.
* **Targets:**
  * `roster-service/src/main/resources/application-dev.yml`: set `analytics.service.url: ${ANALYTICS_SERVICE_URL:http://localhost:8081}`
  * `roster-service/src/main/resources/application-cloud.yml`: set `analytics.service.url: ${ANALYTICS_SERVICE_URL:}` (empty by default in cloud)
  * `roster-service/.../RosterController.java`: inject `@Nullable @Property(name = "analytics.service.url") String analyticsServiceUrl;` and conditionally emit `submit_match`:
    ```java
    if (analyticsServiceUrl != null && !analyticsServiceUrl.isBlank()) {
        String baseUrl = analyticsServiceUrl.endsWith("/")
            ? analyticsServiceUrl.substring(0, analyticsServiceUrl.length() - 1)
            : analyticsServiceUrl;
        links.put("submit_match", new LinkDto(baseUrl + "/api/v1/matches/submit", "POST"));
    }
    ```

### 3.4 `match-analytics-service` — Cold-Start Resilience (`@Retryable` + Timeouts)
**Why:** When all 3 Cloud Run services scale to `0`, a single `submit_match` call triggers a cascading cold start (`analytics` -> `roster` -> `rank-calculator` -> `roster`). Default HTTP client timeouts (~10s) can fail before downstream JVM + Flyway + Neon SSL finish booting.
* **Targets:**
  * `match-analytics-service/src/main/resources/application-cloud.yml`:
    ```yaml
    micronaut:
      http:
        client:
          read-timeout: 25s
          connect-timeout: 10s
    ```
  * Outbound HTTP client interfaces/adapters in `match-analytics-service` calling `roster-service` and `rank-calculator-service`: annotate remote calls with `@io.micronaut.retry.annotation.Retryable(attempts = "3", delay = "1s", multiplier = "2.0")` (built into `micronaut-context`, zero extra dependencies).

### 3.5 `frontend/package.json` & Frontend Cold-Start Pre-Warming
**Why:**
1. `vite build` without `--mode cloud` ignores `.env.cloud` and compiles `VITE_*` variables as `undefined`.
2. Calling `/health` silently on app load wakes up scaled-to-zero Cloud Run instances while the user inspects the UI.
* **Targets:**
  * `frontend/package.json`:
    * `"build:cloud": "vite build --mode cloud"`
    * `"deploy": "vite build --mode cloud && firebase deploy --only hosting"`
  * Frontend bootstrap (`frontend/src/main.js` or API client init):
    * Fire-and-forget `fetch(`${ROSTER_URL}/health`).catch(() => {})` and `fetch(`${ANALYTICS_URL}/health`).catch(() => {})` on initial load.
    * Use a `30000ms` timeout (`AbortSignal.timeout(30000)`) and display a subtle HUD status hint (e.g., `WAKING UP CLOUD SERVICES...`) if a request takes longer than `1.5s`.
  * Verify `resolveHalUrl(href)` resolves relative paths against `VITE_ROSTER_SERVICE_URL` while preserving absolute `https://...` URLs from `_links.submit_match`.

### 3.6 Root `.env.cloud.example`, `.gitignore`, and `Makefile`
* **`.gitignore`:** Ensure `.env.cloud` and `.firebaserc` are ignored; keep `.env.cloud.example` tracked.
* **`.env.cloud.example`:**
  ```env
  GCP_PROJECT_ID=your-gcp-project-id
  GCP_REGION=europe-central2
  JDBC_DATABASE_URL=jdbc:postgresql://ep-example.eu-central-2.aws.neon.tech/vth_db?sslmode=require
  DB_USER=vth_user
  DB_PASSWORD=change-me
  ```
* **`Makefile` (`deploy-cloud` & `deploy-frontend`):**
  * Load `.env.cloud` and validate all 5 required variables before running `gcloud`.
  * Pass `--cpu-boost --memory=512Mi --min-instances=0 --max-instances=3 --allow-unauthenticated` to all `gcloud run deploy` commands.
  * Execute Two-Phase wiring (`gcloud run services update roster-service --update-env-vars="ANALYTICS_SERVICE_URL=$$ANALYTICS_URL"`).
  * Build frontend with inline `VITE_ROSTER_SERVICE_URL=$$ROSTER_URL VITE_ANALYTICS_SERVICE_URL=$$ANALYTICS_URL` and deploy with `npx --prefix frontend firebase deploy --only hosting --project $(GCP_PROJECT_ID)` (eliminating the mandatory `.firebaserc` setup step).

---

## 4. Operational Caveats & Student Pitfalls to Watch

1. **Neon PostgreSQL Connection Pooling & SSL:**
   * Always include `?sslmode=require` in `JDBC_DATABASE_URL`.
   * Do **not** use Neon's `-pooler` endpoint if Flyway advisory locks fail on transaction-mode PgBouncer; use the direct Neon connection string since HikariCP already limits each Cloud Run instance to `maximum-pool-size: 5` (`3 instances max x 5 conns = 15 connections`, well within Neon free-tier limits).
2. **CORS Configuration on Cloud Run Backends:**
   * Because Firebase Hosting serves the UI from `https://<GCP_PROJECT_ID>.web.app` and `https://<GCP_PROJECT_ID>.firebaseapp.com`, ensure Micronaut CORS in `application-cloud.yml` allows these origins (or `allowed-origins: "*"` for the educational lab setup) and exposes headers needed by the client.
3. **IAM & Organization Policies on Student GCP Accounts:**
   * Standard personal Gmail GCP accounts work out of the box with `--allow-unauthenticated`.
   * If a student uses a university/workspace account with `iam.allowedPolicyMemberDomains` restrictions, `gcloud run deploy --allow-unauthenticated` may warn that public access was blocked; document that personal GCP accounts (or project-level policy override) are recommended for free-tier labs.
4. **GCP APIs Enablement (One-Time Setup):**
   * Before running `make deploy-cloud`, students must run once:
     ```bash
     gcloud services enable run.googleapis.com artifactregistry.googleapis.com containerregistry.googleapis.com firebasehosting.googleapis.com --project=<GCP_PROJECT_ID>
     ```
   * And configure Docker/Jib credentials: `gcloud auth configure-docker`.
5. **Cold-Start UX Expectations:**
   * Explain to students that `--min-instances=0` guarantees **$0 idle cost**, at the trade-off of a ~4–6 second wakeup on the very first request after 15 minutes of inactivity (`--cpu-boost` cuts this roughly in half).
