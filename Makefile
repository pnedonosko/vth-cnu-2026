# Valorant Tactical Hub — Monorepo Automation Makefile
GRADLE_VERSION := 9.9.1

ifneq (,$(wildcard .env.cloud))
    include .env.cloud
    export
endif

.PHONY: setup-gradle init up-db down-db test build check-cloud-env build-docker run-roster run-analytics run-rank dev-frontend dev-mock dev-api deploy-cloud deploy-frontend

# --- Підготовка проєкту та залежностей ---
setup-gradle:
	gradle wrapper --gradle-version $(GRADLE_VERSION) --distribution-type bin
	chmod +x gradlew

init:
	./gradlew classes testClasses
	npm --prefix frontend install
	npm --prefix open-api install

# --- Локальна розробка (Завдання після Лекції 2) ---
up-db:
	docker compose up -d

down-db:
	docker compose down

test:
	./gradlew test
	npm --prefix frontend run test

build:
	./gradlew clean build
	npm --prefix frontend run test

run-roster:
	VTH_ENVIRONMENT=dev ./gradlew :roster-service:run

run-analytics:
	VTH_ENVIRONMENT=dev ./gradlew :match-analytics-service:run

run-rank:
	VTH_ENVIRONMENT=dev ./gradlew :rank-calculator-service:run

dev-frontend:
	npm --prefix frontend run dev

dev-mock:
	npm --prefix frontend run dev:mock

dev-api:
	npm --prefix open-api run dev

# --- Збірка Docker-образів та деплой у Google Cloud Run + Neon ---
check-cloud-env:
	@test -f .env.cloud || (echo "ERROR: .env.cloud not found. Copy .env.cloud.example to .env.cloud first." && exit 1)
	@test -n "$(GCP_PROJECT_ID)" || (echo "ERROR: GCP_PROJECT_ID is not set in .env.cloud" && exit 1)
	@test -n "$(GCP_REGION)" || (echo "ERROR: GCP_REGION is not set in .env.cloud" && exit 1)
	@test -n "$(JDBC_DATABASE_URL)" || (echo "ERROR: JDBC_DATABASE_URL is not set in .env.cloud" && exit 1)
	@test -n "$(DB_USER)" || (echo "ERROR: DB_USER is not set in .env.cloud" && exit 1)
	@test -n "$(DB_PASSWORD)" || (echo "ERROR: DB_PASSWORD is not set in .env.cloud" && exit 1)

build-docker: check-cloud-env
	./gradlew jib

deploy-cloud: check-cloud-env
	@echo "=== [1/4] Deploying rank-calculator-service ==="
	gcloud run deploy rank-calculator-service \
		--image=$(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT_ID)/valorant-repo/rank-calculator-service:latest \
		--project=$(GCP_PROJECT_ID) \
		--region=$(GCP_REGION) \
		--platform=managed \
		--allow-unauthenticated \
		--memory=512Mi \
		--cpu-boost \
		--min-instances=0 \
		--max-instances=3 \
		--set-env-vars="VTH_ENVIRONMENT=cloud,JDBC_DATABASE_URL=$(JDBC_DATABASE_URL),DB_USER=$(DB_USER),DB_PASSWORD=$(DB_PASSWORD)"

	@echo "=== [2/4] Deploying roster-service (Phase 1: without ANALYTICS_SERVICE_URL) ==="
	gcloud run deploy roster-service \
		--image=$(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT_ID)/valorant-repo/roster-service:latest \
		--project=$(GCP_PROJECT_ID) \
		--region=$(GCP_REGION) \
		--platform=managed \
		--allow-unauthenticated \
		--memory=512Mi \
		--cpu-boost \
		--min-instances=0 \
		--max-instances=3 \
		--set-env-vars="VTH_ENVIRONMENT=cloud,JDBC_DATABASE_URL=$(JDBC_DATABASE_URL),DB_USER=$(DB_USER),DB_PASSWORD=$(DB_PASSWORD)"

	@echo "=== [3/4] Deploying match-analytics-service ==="
	@RANK_URL=$$(gcloud run services describe rank-calculator-service --project=$(GCP_PROJECT_ID) --region=$(GCP_REGION) --format='value(status.url)'); \
	ROSTER_URL=$$(gcloud run services describe roster-service --project=$(GCP_PROJECT_ID) --region=$(GCP_REGION) --format='value(status.url)'); \
	gcloud run deploy match-analytics-service \
		--image=$(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT_ID)/valorant-repo/match-analytics-service:latest \
		--project=$(GCP_PROJECT_ID) \
		--region=$(GCP_REGION) \
		--platform=managed \
		--allow-unauthenticated \
		--memory=512Mi \
		--cpu-boost \
		--min-instances=0 \
		--max-instances=3 \
		--set-env-vars="VTH_ENVIRONMENT=cloud,JDBC_DATABASE_URL=$(JDBC_DATABASE_URL),DB_USER=$(DB_USER),DB_PASSWORD=$(DB_PASSWORD),ROSTER_SERVICE_URL=$$ROSTER_URL,RANK_CALCULATOR_URL=$$RANK_URL,RANK_SERVICE_URL=$$RANK_URL"

	@echo "=== [4/4] Phase 2 Wiring: Injecting ANALYTICS_SERVICE_URL into roster-service ==="
	@ANALYTICS_URL=$$(gcloud run services describe match-analytics-service --project=$(GCP_PROJECT_ID) --region=$(GCP_REGION) --format='value(status.url)'); \
	gcloud run services update roster-service \
		--project=$(GCP_PROJECT_ID) \
		--region=$(GCP_REGION) \
		--update-env-vars="ANALYTICS_SERVICE_URL=$$ANALYTICS_URL"

deploy-frontend: check-cloud-env
	@echo "=== Building and deploying Frontend to Firebase Hosting ==="
	@ROSTER_URL=$$(gcloud run services describe roster-service --project=$(GCP_PROJECT_ID) --region=$(GCP_REGION) --format='value(status.url)'); \
	ANALYTICS_URL=$$(gcloud run services describe match-analytics-service --project=$(GCP_PROJECT_ID) --region=$(GCP_REGION) --format='value(status.url)'); \
	echo "Injecting ROSTER_URL=$$ROSTER_URL and ANALYTICS_URL=$$ANALYTICS_URL"; \
	VITE_ROSTER_SERVICE_URL=$$ROSTER_URL VITE_ANALYTICS_SERVICE_URL=$$ANALYTICS_URL npm --prefix frontend run build:cloud && \
	npx --prefix frontend firebase-tools deploy --only hosting --project $(GCP_PROJECT_ID)
