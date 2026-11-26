# Valorant Tactical Hub — Starter Kit

Навчальний мікросервісний монорепозиторій (`ua.cdu.edu.fotius.fspm.valorant`).

**Технологічний стек:** Java 25, Gradle 9.9.1, Micronaut 5.0.2 (`jakarta.inject`), Jib 3.5.2, PostgreSQL 18, Flyway, JDBI 3, Testcontainers, Vite + TailwindCSS.

## Архітектура та Модулі

1. **`roster-service`** (Port 8080): Контекст *Tactical Draft*. Машина станів (`DRAFT` -> `LOCKED` -> `ARCHIVED`), HATEOAS HAL (`_links`), рольова модель (`CAPTAIN` / `PLAYER`).
2. **`match-analytics-service`** (Port 8081): Контекст *Match History*. Валідація результату матчу, міжсервісний REST-виклик в `rank-calculator-service`, перехід стану `roster-service` в `ARCHIVED` після фіксації гри.
3. **`rank-calculator-service`** (Port 8082): *Stateless Pure Domain Service*. Обчислення дельти рейтингу (RR), перформанс-бонуси, штрафи, просування по рангу (TDD).
4. **`frontend`**: Tactical HUD Console на Vite, Vanilla JS та TailwindCSS. Dynamic UI керується наявністю `_links`. Реалізує **Fault Tolerance & Offline-First Seed** (миттєвий рендер пріоритетного пулу мета-агентів із committed seed, фонова гідрація з Riot Games API та локальне кешування).

---

## Початок роботи з GitHub та елементи GitOps (GitHub Actions CI)

Робота над лабораторними виконується у вашому **власному форку** репозиторію (без створення Pull Request у оригінальний репозиторій викладача):

1. Натисніть кнопку **Fork** у правому верхньому куті цього репозиторію на GitHub та створіть форк у власному акаунті.
2. Склонуйте **свій** форк локально:
   ```bash
   git clone https://github.com/<ВАШ_ЛОГІН>/vth-cnu-2026.git
   cd valorant-tactical-hub
   ```
3. *(Необовʼязково)* Додайте оригінальний репозиторій викладача як `upstream`, щоб за потреби підтягувати оновлення:
   ```bash
   git remote add upstream https://github.com/pnedonosko/vth-cnu-2026.git
   ```
4. *(Необовʼязково)* Увімкніть GitHub Actions CI у своєму форку:
   * Відкрийте вкладку **Actions** у вашому форку на GitHub та натисніть зелену кнопку *«I understand my workflows, go ahead and enable them»*.
   * Тепер при кожному `git push` GitHub автоматично компілюватиме всі три сервіси, запускатиме Unit + Testcontainers тести та перевірятиме збірку фронтенду.
5. **Безпека секретів:** ніколи не комітьте файл `.env.cloud` із паролями від Neon PostgreSQL (він уже доданий у `.gitignore`).

---

## Архітектурна структура та навчальні завдання

1. **`roster-service` (Зразок Pragmatic DDD + Light Hexagonal):**
   * `domain/` — Aggregate Root `Roster`, Value Objects (`AgentPick`, `RosterId`, `PlayerId`, `AgentKey`), порт до БД `RosterRepository`.
   * `application/` — `RosterApplicationService` (оркестрація Use Cases через `jakarta.inject`).
   * `infrastructure/` — `JdbiRosterRepository` (JDBI 3 + HikariCP) та `RosterController` (REST, HAL `_links`, Micronaut Validation).
2. **`match-analytics-service` (Лабораторна робота №1 — Рефакторинг у DDD):**
   * Навмисно реалізований у стилі *Transaction Script* (SQL через JDBI 3 прямо в `MatchController`).
   * **Завдання:** винести бізнес-логіку та інваріанти в доменну модель, виділити порт репозиторію та `MatchApplicationService` за зразком `roster-service`.
3. **`rank-calculator-service` (Лабораторна робота №2 — Перехід на DI):**
   * Використовує `@FunctionalInterface RatingPolicy` зі статичним методом `defaultCompetitivePolicy`.
   * **Завдання:** перевести розрахунок рейтингу на інжектовані `@Singleton` біни через `jakarta.inject` з конфігурованими коефіцієнтами.

**Увага**: для спрощення ми використовуємо фіксоване призначення слотів в ростері до гравців в БД, тобто слот 1 призначається жорстко гравцю з `playerId="p-001"`, а слот 2 для `playerId="p-001"` і тд.

---

## Швидка навігація по монорепозиторію (утиліти fd та rg)

Під час дослідження кодової бази та рефакторингу Match Analytics за зразком roster-service можна використати CLI-утиліти `fd` (пошук файлів і директорій) та `rg` (ripgrep - пошук по вмісту коду) замість ручного перегляду папок у IDE:

1. Пошук файлів, пакетів та модулів (`fd`):
   - Знайти всі директорії (пакети) в межах еталонного сервісу, щоб побачити його пошарову структуру:
      ```bash
      fd -t d . roster-service
      ```
   - Знайти всі Java-файли в конкретному мікросервісі:
      ```bash
      fd -e java . match-analytics-service 
      ```
   - Знайти всі файли контролерів у всьому монорепозиторії (ігноруючи регістр):
      ```bash
      fd -i controller
      ```
   - Знайти міграції бази даних або SQL-скрипти початкового заповнення (наприклад, V2__seed_data.sql):
      ```bash
      fd -e sql
      ```
   - Знайти конфігураційні файли сервісів (application.yml / .properties), де задані порти та URL сусідніх сервісів:
      ```bash
      fd "application\.(yml|yaml|properties)"
      ```
2. Пошук класів, методів та місць їх виклику (`rg`):
   - Знайти оголошення класів та інтерфейсів у пакеті сервісу (наприклад, у roster-service):
      ```bash
      rg "class |interface " roster-service
      ```
   - Знайти оголошення конкретного класу (наприклад, RosterApplicationService або обробника винятків):
      ```bash
      rg "class (RosterApplicationService|DomainExceptionHandler)"
      ```
   - Знайти всі публічні методи в сервісах додатку або контролерах (пошук лише по Java-файлах через -t java):
      ```bash
      rg -t java "public .*\(" match-analytics-service
      ```
   - Знайти всі місця, де викликається конкретний метод чи інтеграційний клієнт (наприклад, звернення до rankClient або rosterClient):
      ```bash
      rg -t java "(rankClient|rosterClient)\." match-analytics-service
      ```
   - Знайти ендпоінти REST API (анотації @Get, @Post, @Patch, @Controller) по всьому проєкту:
      ```bash
      rg -t java "@(Controller|Get|Post|Patch|Delete)"
      ```

---

## 1. Ініціалізація та локальний запуск (Після Лекції "Плануємо мікросервісний додаток")

1. **Ініціалізуйте залежності проєкту** (один раз після `git clone`):
   ```bash
   make init
   ```
2. **Запустіть ізольовані бази даних PostgreSQL:**
   ```bash
   make up-db
   ```
3. **Запустіть мікросервіси** (у трьох окремих терміналах):
   ```bash
   make run-roster      # http://localhost:8080
   make run-analytics   # http://localhost:8081
   make run-rank        # http://localhost:8082
   ```
4. **Запустіть Frontend SPA та Swagger UI:**
   ```bash
   make dev-frontend    # http://localhost:3000 (повний стек із бекендом)
   make dev-mock        # http://localhost:3000 (автономний режим без бекенду)
   make dev-api         # http://localhost:3001 (Swagger UI OpenAPI 3.1)
   ```
5. **Запуск тестів** (Unit + Testcontainers PostgreSQL 18):
   ```bash
   make test
   ```

### Команди перевірки REST-сервісів

Команди подано з авторизацією Капітана (`jwt-token-for-ProGamer#EUW`) та ID його користувача `p-001`. Інших можна знайти в коді (roseter-service -> V2__seed_data.sql).

1. Стан ростеру 
   ```bash
   curl -i -H "Authorization: Bearer jwt-token-for-ProGamer#EUW" http://localhost:8080/api/v1/rosters/r-101
   ```
2. Призначення агента в драфті ростера
   ```bash
   curl -i -X POST \
      -H "Authorization: Bearer jwt-token-for-ProGamer#EUW" \
      -H "Content-Type: application/json" \
      -H "X-Player-Id: p-001" \
      -d '{
         "slot": 3,
         "playerId": "p-003",
         "agentKey": "abs"
      }' \
      http://localhost:8080/api/v1/rosters/r-101/agents
   ```
   Де: 
      - slot (1..5) — номер слоту в команді (наприклад, 5 для тестування додавання 5-го чи 6-го агента в DRAFT або зміни вже зафіксованого складу LOCKED).
      - agentId — ідентифікатор агента з каталогу valorant-api.com (у прикладі вказано UUID агента Jett, оскільки в коді є валідація формату UUID агентів).
      - playerId — ідентифікатор гравця, який обирає цього агента.  
3. Видалення агента з ростеру
   ```bash
   curl -i -X DELETE \
      -H "Authorization: Bearer jwt-token-for-ProGamer#EUW" \
      -H "X-Player-Id: p-001" \
      http://localhost:8080/api/v1/rosters/r-101/agents/deadlock
   ```  
4. Запит аналітики (для гравця `playerId="p-001"`)
   ```bash
   curl -i http://localhost:8081/api/v1/matches/history/p-001
   ```    
5. Безпосереднє обчислення рангу в rank-calculator-service:
   ```bash
   curl -i -X POST \
      -H "Content-Type: application/json" \
      -d '{"isWin":true,"roundMargin":5,"kills":22,"deaths":12,"assists":5,"combatScore":310,"isAfk":false}' \
      http://localhost:8082/internal/v1/calculate-rating
   ```

---

## 2. Налаштування Хмари: Google Cloud Run + Neon PostgreSQL

Кожен студент розгортає власну копію системи у своєму Google Cloud проєкті та безкоштовному інстансі **Neon**.

### Крок А. Створення баз даних у Neon
1. Зареєструйтесь на [neon.tech](https://neon.tech) та створіть новий проєкт (**PostgreSQL 18**, регіон бажано обрати найближчий до вашого Cloud Run, наприклад `aws-us-east-1` для `us-central1`).
2. У вкладці **Databases** створіть дві окремі бази даних (дотримання *Database per Service*):
   * `roster_db`
   * `analytics_db`
3. На вкладці **Dashboard / Connection Details** скопіюйте **Direct connection** рядок (важливо: **вимкніть** галочку *Connection pooling* / приберіть `-pooler` з хоста, оскільки Flyway використовує `pg_advisory_lock`).

### Крок Б. Підготовка Google Cloud (`gcloud`)
1. Створіть проєкт у [Google Cloud Console](https://console.cloud.google.com) та авторизуйтесь у CLI:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
2. Увімкніть необхідні API (Cloud Run та Artifact Registry):
   ```bash
   gcloud services enable \
      run.googleapis.com \
      artifactregistry.googleapis.com \
      containerregistry.googleapis.com \
      firebasehosting.googleapis.com
   ```
3. Автентифікуйтесь та створіть репозиторій для Docker-образів в GCP Artifact Registry (один раз на проєкт):
   ```bash
   gcloud auth configure-docker # login in gcr.io

   gcloud artifacts repositories create cnu-repo \
     --repository-format=docker \
     --location=${GCP_REGION} \
     --description="CNU Docker images"

   gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev # login in your region Artifact Registry
   ```

### Крок В. Автентифікація у Firebase (один раз на проект — обов’язково перед деплоєм фронтенду)
1. Увійдіть у Firebase CLI:
   ```bash
   npx firebase-tools login
   ```
   Це відкриє браузер для автентифікації через Google акаунт.

### Крок Г. Конфігурація та автоматизований деплой
1. Скопіюйте шаблон змінних оточення:
   ```bash
   cp .env.cloud.example .env.cloud
   ```
2. Впишіть у `.env.cloud` ваш `GCP_PROJECT_ID`, `GCP_REGION`, `ROSTER_JDBC_DATABASE_URL`, `ANALYTICS_JDBC_DATABASE_URL`, `DB_USER` та `DB_PASSWORD`. `GCP_REGION` - рекомендовано залишити `europe-west3` - PostgreSQL працює в тій же зоні.
3. Зберіть Docker-образи через Jib та опублікуйте в GCP Artifact Registry
   ```bash
   make build-docker
   ```
4. Виконайте деплой всіх мікросервісів у Cloud Run:
   ```bash
   make deploy-cloud
   ```
   *Під час старту в хмарі сервіси активують профіль `VTH_ENVIRONMENT=cloud` (`application-cloud.yml`), де налаштований пул HikariCP під serverless cold-start Neon, а Flyway автоматично застосує SQL-міграції.*
5. Задеплойте фронтенд у Firebase Hosting.
   ```bash
   make deploy-frontend
   ```
6. По завершенню роботи — зупиніть мікросервіси та фронтенд, видаліть образи в GCP Artifact Registry.
   ```bash
   make clean-all
   ```

