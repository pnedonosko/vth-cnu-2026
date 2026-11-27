# ADR 001 — Frontend Architecture: HATEOAS/HAL-Driven SPA

**Статус:** Accepted
**Дата:** 2026-11-25
**Автор:** Петро Недоноско (nedonosko.petro1126@vu.cdu.edu.ua)
**Область:** frontend (Vite, Vanilla JS, TailwindCSS)

---

## Контекст (Scope)

Фронтенд Valorant Tactical Hub — це одно сторінковий додаток (SPA), що працює в браузері і звертається напряму до двох мікросервісів (`roster-service` на порту 8080, `match-analytics-service` на 8081). Він не має власного бекенду (BFF/API Gateway). Фронтенд є **чистим споживачем** (pure consumer) мікросервісів.

Ключове завдання: зробити так, щоб фронтенд **не знав** про бізнес-логіку, стани, URL-адреси дій та правила переходів — усе це повинен надавати бекенд через гіпермедіа.

---

## Рішення (Decision)

Фронтенд реалізований як **HATEOAS/HAL-клієнт рівня 3** (за Richardson Maturity Model). Сервер є єдиним джерелом істини щодо того, які дії доступні користувачу в поточному стані.

### 1. Сервер керує UI через `_links`
Кожна відповідь `RosterResponseDto` містить поле `_links` (HAL). Фронтенд:
- **Рендерить** контрол (кнопку) **тоді і тільки тоді**, коли відповідний ключ присутній у `_links`.
- **Виконує** дію, слідуючи за `_links` (href + method), а не за реконструйованим шляхом.

```js
if (roster._links && roster._links.lock_in) {
    const btn = document.createElement('button');
    btn.onclick = () => executeHalAction(roster._links.lock_in);
    // ...
}
```

### 2. Крос-сервісна навігація через абсолютні href
Поле `submit_match` в `_links` ростеру вказує на `match-analytics-service` (наприклад, `http://localhost:8081/api/v1/matches/submit`). Функція `resolveHalUrl(href)` обробляє обидва випадки:
- Абсолютний URL (`http(s)://...`) → використовується як є (фронтенд **не знає** про analytics base URL).
- Відносний href (`/api/v1/rosters/...`) → додається префікс `ROSTER_SERVICE`.

### 3. Re-GET після кожної мутації
Після будь-якої дії (lock, unlock, add/remove agent, unarchive, submit match) викликається `loadRoster()`, який повторно завантажує ростер. Сервер повертає оновлений `_links` для нового стану — клієнт не вгадує, які кнопки показувати.

### 4. Оффлайн-перший / graceful degradation (Mock Mode)
Якщо `ROSTER_SERVICE === 'mock'`, фронтенд працює без бекенду. Mock-режим **симулює сервер** через єдину функцію `mockServerLinks(roster)`, що віддзеркалює `RosterController.toHalResponse()`. Логіка дій (`executeHalAction`, `unarchiveRoster`, тощо) **ідентична** в обох режимах — різниця лише в джерелі даних.

### 5. Патерн стійкості до cold-start (Cloud Run)
- `prewarmCloudServices()` — fire-and-forget `fetch` до `/health` обох сервісів при завантаженні сторінки (пробуджує scale-to-zero інстанси).
- `apiFetch(url, options)` — обгортка над `fetch()` з:
  - `AbortSignal.timeout(30000)` (запобігає зависанню при cold start).
  - Показ підказки «WAKING UP CLOUD SERVICES...» після 1.5 с.
- `isValidMatchResult(data)` — захист від хибного «зеленого» результату при помилці сервера (перевіряє, що `deltaRR` — число і `tierStatus` — рядок).

### 6. Розділення відповідальностей
- **Бекенд** володіє всією бізнес-логікою (правила локування, перевірка капітана, переходи станів, валідація).
- **Фронтенд** — чисте представлення (presentation-only). Він не містить правил бізнес-логіки, лише рендерить те, що сервер дозволяє через `_links`.

---

## Дані (Data)

### Вхідні дані (з бекенду)
- `GET /api/v1/rosters/r-101` → `RosterResponseDto` з полями `id`, `captainId`, `mapName`, `status`, `members[]`, `_links`.
- `POST /api/v1/matches/submit` → `MatchSubmissionResponse(matchId, deltaRR, tierStatus)`.

### Локальний стан
- `currentRoster` — єдиний об'єкт ростеру, що кешується в пам'яті (не в localStorage).
- `availableAgents` — каталог агентів з Riot API (кешується в `localStorage`).

### Джерела `_links`
- **Live**: сервер (`RosterController.toHalResponse`).
- **Mock**: `mockServerLinks(roster)` — імітує серверний HAL-відповідь.

---

## Приймальні критерії (Acceptance Criteria)

1. **UI не містить жодного hardcoded шляху для дій** (lock/unlock/unarchive/add/remove/submit) — всі URL беруться з `_links`.
2. **Кожна кнопка рендериться тоді і тільки тоді**, коли відповідний `_links` присутній.
3. **`resolveHalUrl`** коректно обробляє як відносні, так і абсолютні href.
4. **Mock-режим** використовує `mockServerLinks` — логіка дій ідентична live-режиму.
5. **Після кожної мутації** викликається `loadRoster()` (re-GET).
6. **Тести (Vitest)** перевіряють контракт `_links` → UI (15 тестів).
7. **`isValidMatchResult`** запобігає хибному зеленому результату при помилці сервера.

---

## Наслідки (Consequences)

### Позитивні
- Фронтенд не зламається при зміні URL бекенду — сервер володіє маршрутизацією.
- Нові дії (наприклад, нова рольова модель) додаються на бекенді без зміни фронтенду.
- Mock-режим і live-режим мають ідентичну логіку дій.
- Фронтенд захищений від cold-start помилок (timeout + pre-warm).

### Негативні / Компроміси
- Re-GET після кожної мутації → додатковий HTTP-запит (1 RTT).
- Фронтенд залежить від наявності `_links` у відповіді — якщо бекенд поверне неповний HAL, UI буде неповним (наприклад, кнопка не з'явиться).
- Mock-режим дублює бекенд-логіку (`mockServerLinks`) — якщо бекенд змінить links, mock треба оновити.
- `submit_match` href захардкоджений на бекенді (`http://localhost:8081/...`) — в cloud це має працювати через конфіг.

---

## Пов'язані рішення (Related)
- ADR 002 — Microservices Architecture (Database per Service, HATEOAS)
- ADR 003 — Cloud Deployment (Cloud Run + Neon + Firebase)
- `RosterController.toHalResponse()` — єдине місце, де емітуються `_links`
- `frontend/src/main.js` — `resolveHalUrl()`, `mockServerLinks()`, `isValidMatchResult()`
- `frontend/src/main.test.js` — контрактні тести HATEOAS (15 тестів)
- `roster-service/.../RosterControllerTest.java` — `HalLinksContract` (3 тести)