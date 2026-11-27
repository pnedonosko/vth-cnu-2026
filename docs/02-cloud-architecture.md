# ADR 002 — Cloud Deployment Architecture: Cloud Run + Neon + Firebase

**Статус:** Accepted
**Дата:** 2026-11-27
**Автор:** Петро Недоноско (nedonosko.petro1126@vu.cdu.edu.ua)
**Область:** інфраструктура, деплой, Cloud Run, Neon PostgreSQL, Firebase Hosting

---

## Контекст (Scope)

Valorant Tactical Hub розгортається в Google Cloud Run (3 Micronaut-мікросервіси), Neon PostgreSQL (2 бази даних, Database-per-Service) та Firebase Hosting (SPA-фронтенд). Локальна розробка використовує Docker Compose + PostgreSQL 18.

---

## Рішення (Decision)

### 1. Деплой мікросервісів: Jib + Artifact Registry

Образи будуються через **Jib** (Gradle plugin) і публікуються в **Google Artifact Registry** (`cnu-repo`, регіон `europe-west3`). Jib не потребує Dockerfile — він автоматично створює layered image з класів Gradle.

- **Platform pin:** `linux/amd64` (щоб ARM64-машини студентів не пушіли ARM-образи, які Cloud Run відхиляє).
- **JVM flags:** `-Xms64m -Xmx256m -XX:+UseSerialGC` (мінімізація пам'яті для free tier).
- **Cold start:** `--cpu-boost` + `min-instances=0` + `max-instances=3` — scale-to-zero для $0 idle, boost для швидкого старту.

### 2. Database-per-Service (Neon PostgreSQL)

Кожен сервіс має власну базу в Neon:
- `roster-service` → `roster_db` (через `ROSTER_JDBC_DATABASE_URL`)
- `match-analytics-service` → `analytics_db` (через `ANALYTICS_JDBC_DATABASE_URL`)
- `rank-calculator-service` → **без БД** (stateless, чистий домен)

**Cloud profile (`application-cloud.yml`):** `url`, `username`, `password` беруться з env vars (без localhost-фолбеків). **Dev profile (`application-dev.yml`):** localhost-фолбеки на порти 5432/5433.

### 3. Двофазний деплой (Two-Phase Deployment)

Cloud Run призначає динамічні `*.run.app` URL при створенні сервісу. Оскільки `roster-service` і `match-analytics-service` залежать один від одного через HATEOAS-посилання, використовується двофазний підхід:

```
Phase 1: rank-calculator-service → roster-service (без ANALYTICS_SERVICE_URL)
Phase 2: match-analytics-service (отримує ROSTER_URL, RANK_URL)
Phase 3: roster-service update (інжектується ANALYTICS_SERVICE_URL)
```

- `roster-service` у Phase 1 **не емітує** `_links.submit_match` (бо `analytics.service.url` порожній).
- Після Phase 3 — оновлюється env var, і `submit_match` з'являється в `_links` при наступному GET.

### 4. HATEOAS-посилання в Cloud

- `submit_match` href = `${ANALYTICS_SERVICE_URL}/api/v1/matches/submit` (абсолютний URL, емітується сервером).
- Фронтенд використовує `resolveHalUrl(href)` — абсолютні href передаються verbatim, відносні отримують префікс `ROSTER_SERVICE`.
- Якщо `analytics.service.url` не задано (Phase 1), посилання `submit_match` **не емітується** — UI не показує кнопку submit (жодного хардкоду).

### 5. Cold-Start Resilience

- **Backend:** `@Retryable(attempts = "3", delay = "1s", multiplier = "2.0")` на `RosterServiceClient` та `RankCalculatorClient` в `match-analytics-service` (Micronaut Retry, zero extra dependencies).
- **Timeouts:** `read-timeout: 25s`, `connect-timeout: 10s` в `application-cloud.yml`.
- **Frontend:** `apiFetch()` з `AbortSignal.timeout(30000)` + індикатор «WAKING UP CLOUD SERVICES...» після 1.5 с; `prewarmCloudServices()` — fire-and-forget `/health` fetch при завантаженні сторінки.

### 6. Фронтенд (Firebase Hosting)

- Vite build з `--mode cloud` читає `.env.cloud` (або inline env vars з Makefile).
- `deploy-frontend` target інжектує `VITE_ROSTER_SERVICE_URL` та `VITE_ANALYTICS_SERVICE_URL` з live Cloud Run URLs.
- `.firebaserc` не потрібен — `--project $(GCP_PROJECT_ID)` передається через Makefile.
- `frontend/.firebase/` (кеш CLI) додано до `.gitignore`.

### 7. Cleanup Targets

| Target | Дія |
|--------|-----|
| `make teardown-cloud` | Видаляє Cloud Run сервіси + вимикає Firebase Hosting |
| `make clean-images` | Видаляє Docker-образи з `cnu-repo` |
| `make clean-all` | `teardown-cloud` + `clean-images` (репозиторій зберігається — порожній репо безкоштовний) |

---

## Дані (Data)

### Конфігурація (`.env.cloud`)

**Увага**: `ROSTER_JDBC_DATABASE_URL` `ANALYTICS_JDBC_DATABASE_URL` введено замість одного `JDBC_DATABASE_URL` як планувалося в [00-gcp-deploy-design.md](00-gcp-deploy-design.md), тому що Neon JDBC URLs відрізняються для кожної БД.

```
GCP_PROJECT_ID=my-vth-student-project
GCP_REGION=europe-central2
ROSTER_JDBC_DATABASE_URL=jdbc:postgresql://.../roster_db?sslmode=require
ANALYTICS_JDBC_DATABASE_URL=jdbc:postgresql://.../analytics_db?sslmode=require
DB_USER=neondb_owner
DB_PASSWORD=replace-with-neon-password
```

### Розгорнуті сервіси

| Сервіс | Порт | База даних | Залежності |
|--------|------|-----------|------------|
| `roster-service` | 8080 | Neon `roster_db` | — |
| `match-analytics-service` | 8081 | Neon `analytics_db` | `roster-service`, `rank-calculator-service` |
| `rank-calculator-service` | 8082 | — (stateless) | — |

---

## Приймальні критерії (Acceptance Criteria)

1. `make build-docker` будує linux/amd64 образи та пушить у Artifact Registry (`cnu-repo`).
2. `make deploy-cloud` деплоїть 3 сервіси bottom-up з Phase 2 wiring.
3. `make deploy-frontend` будує Vite з `--mode cloud` і деплоїть у Firebase Hosting.
4. `GET /api/v1/rosters/{id}` в cloud повертає `_links.submit_match` з реальним Cloud Run URL (не `localhost`).
5. Cold-start: перший запит після 15 хв неактивності не падає з timeout (retry + 25s read-timeout).
6. `make teardown-cloud` / `make clean-all` коректно очищають ресурси.

---

## Відомі обмеження та компроміси (Known Issues & Compromises)

1. **`roster_id` в analytics DB не є реальним FK** — це просто VARCHAR(36), оскільки ростер живе в іншій БД (`roster_db`). Цілісність даних залежить від додаткової перевірки в `match-analytics-service`.
2. **`match_players` зберігає лише одного гравця** на матч (submitter), хоча таблиця може містити кілька рядків.
3. **`isAfk` не персистується** — використовується лише для розрахунку рейтингу, потім відкидається.
4. **CORS відкритий** (`cors.enabled: true` без обмеження origins) — прийнятно для навчального проєкту, але для продакшену потрібно обмежити origins.
5. **`min-instances=0`** → cold start ~4–6 с при першому запиті (mitigated by `--cpu-boost` + frontend pre-warm).
6. **`submit_match` href** в `toHalResponse` використовує `${ANALYTICS_SERVICE_URL}` з дефолтом `http://localhost:8081` (dev) / порожній (cloud Phase 1). Якщо env var не задано в cloud — посилання не емітується.
7. **`application-dev.yml` використовує `${JDBC_DATABASE_URL}`** з різними дефолтами — якщо env var задано локально в developer оточенні, обидва сервіси отримають однаковий URL (dev-only concern).
8. **`rank-calculator-service` немає datasource** — чистий stateless-сервіс, що не потребує БД.
9. **`@Retryable` на клієнтських інтерфейсах** — в тестах (Mockito) не спрацьовує, бо Mockito обходить Micronaut AOP. Потребує integration test з реальним HTTP-сервером для валідації.
10. **`agentKey` валідація** (`^[a-zA-Z0-9_-]{2,30}$`) відхиляє `kay/o` (KAY/O) — залишено як навчальне завдання.

---

## Пов'язані рішення (Related)
- `gcp-deploy-design.md` — оригінальний дизайн-документ (не змінювався)
- `docs/matches-submit-activity.puml` — UML діаграма активності процесу фіксації матчу та компенсуючої саги
- `docs/01-frontend-architecture.md` — ADR 001: Frontend Architecture (HATEOAS/HAL-Driven SPA)
- `build.gradle.kts` — Jib configuration (platform pin, container env)
- `Makefile` — cloud deploy/cleanup targets
