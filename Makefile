.DEFAULT_GOAL := help

# Container image settings
REGISTRY       ?= quay.io/rh-ai-community-plugins
FRONTEND_IMAGE ?= brewet
BFF_IMAGE      ?= brewet-bff
SB_IMAGE       ?= brewet-storage-backend
CHART_NAME     ?= brewet-chart  # used by help display only; chart-package/chart-push use chart/ directly
VERSION        ?=
BUILDER        ?= podman
IMAGE_TAG      ?= latest
SEVERITY       ?= HIGH,CRITICAL

# ──────────────────────────────────────────────
# Install
# ──────────────────────────────────────────────

.PHONY: install install-frontend install-bff install-storage-backend

install: install-frontend install-bff install-storage-backend ## Install dependencies (frontend + BFF + storage-backend)

install-frontend:
	npm ci

install-bff:
	cd bff && npm ci

install-storage-backend:
	cd storage-backend && npm ci

# ──────────────────────────────────────────────
# Lint
# ──────────────────────────────────────────────

.PHONY: lint lint-frontend lint-bff lint-storage-backend

lint: lint-frontend lint-bff lint-storage-backend ## Lint source code (frontend + BFF + storage-backend)

lint-frontend:
	npm run lint

lint-bff:
	cd bff && npm run lint

lint-storage-backend:
	cd storage-backend && npm run lint

# ──────────────────────────────────────────────
# Typecheck
# ──────────────────────────────────────────────

.PHONY: typecheck typecheck-frontend typecheck-bff typecheck-storage-backend

typecheck: typecheck-frontend typecheck-bff typecheck-storage-backend ## TypeScript type checking (frontend + BFF + storage-backend)

typecheck-frontend:
	npm run typecheck

typecheck-bff:
	cd bff && npm run typecheck

typecheck-storage-backend:
	cd storage-backend && npm run typecheck

# ──────────────────────────────────────────────
# Test
# ──────────────────────────────────────────────

.PHONY: test test-frontend test-bff test-storage-backend test-coverage

test: test-frontend test-bff test-storage-backend ## Run tests (frontend + BFF + storage-backend)

test-frontend:
	npm test

test-bff:
	cd bff && NODE_OPTIONS=--no-deprecation npm test

test-storage-backend:
	cd storage-backend && npm test

test-coverage: ## Run frontend tests with coverage report
	npm run test:coverage

# ──────────────────────────────────────────────
# Validate (typecheck + lint + test)
# ──────────────────────────────────────────────

.PHONY: validate validate-frontend validate-bff validate-storage-backend

validate: validate-frontend validate-bff validate-storage-backend ## Full validation: typecheck + lint + test (frontend + BFF + storage-backend)

validate-frontend: typecheck-frontend lint-frontend test-frontend

validate-bff: typecheck-bff lint-bff test-bff

validate-storage-backend: typecheck-storage-backend lint-storage-backend test-storage-backend

# ──────────────────────────────────────────────
# Build
# ──────────────────────────────────────────────

.PHONY: build build-frontend build-bff build-storage-backend

build: build-frontend build-bff build-storage-backend ## Production build (frontend + BFF + storage-backend)

build-frontend:
	npm run build

build-bff:
	cd bff && npm run build

build-storage-backend:
	cd storage-backend && npm run build

# ──────────────────────────────────────────────
# Dev servers
# ──────────────────────────────────────────────

.PHONY: dev dev-bff dev-storage-backend

dev: ## Start frontend dev server (port 9500)
	npm run start:dev

dev-bff: ## Start BFF dev server (port 3000, requires K8S_API_BASE)
	cd bff && npm run start:dev

dev-storage-backend: ## Start storage backend dev server (port 8888)
	cd storage-backend && npm run start:dev

# ──────────────────────────────────────────────
# Container images
# ──────────────────────────────────────────────

.PHONY: image-build image-build-frontend image-build-bff image-build-storage-backend
.PHONY: image-push image-push-frontend image-push-bff image-push-storage-backend image-scan

image-build: image-build-frontend image-build-bff image-build-storage-backend ## Build container images

image-build-frontend:
	$(BUILDER) build -t $(REGISTRY)/$(FRONTEND_IMAGE):$(IMAGE_TAG) -f Containerfile .

image-build-bff:
	$(BUILDER) build -t $(REGISTRY)/$(BFF_IMAGE):$(IMAGE_TAG) -f bff/Containerfile bff/

image-build-storage-backend:
	$(BUILDER) build -t $(REGISTRY)/$(SB_IMAGE):$(IMAGE_TAG) -f storage-backend/Containerfile storage-backend/

image-push: ## Build and push container images (frontend + BFF + storage-backend)
	./scripts/build-push.sh all $(VERSION)

image-push-frontend: ## Build and push frontend container image only
	./scripts/build-push.sh frontend $(VERSION)

image-push-bff: ## Build and push BFF container image only
	./scripts/build-push.sh bff $(VERSION)

image-push-storage-backend: ## Build and push storage-backend container image only
	./scripts/build-push.sh storage-backend $(VERSION)

image-scan: ## Build and scan images for vulnerabilities
	BUILDER=$(BUILDER) IMAGE_TAG=$(IMAGE_TAG) ./scripts/scan-image.sh all $(SEVERITY)

# ──────────────────────────────────────────────
# Helm chart
# ──────────────────────────────────────────────

.PHONY: chart-package chart-push

chart-package: ## Package Helm chart into a .tgz archive
	helm package chart/

chart-push: ## Package and push Helm chart to OCI registry (requires Helm 3.8+)
	$(eval CHART_TGZ := $(shell helm package chart/ | awk '{print $$NF}'))
	helm push $(CHART_TGZ) oci://$(REGISTRY)
	@rm -f $(CHART_TGZ)

# ──────────────────────────────────────────────
# Clean
# ──────────────────────────────────────────────

.PHONY: clean

clean: ## Remove build artifacts
	rm -rf dist/ bff/dist/ storage-backend/dist/

# ──────────────────────────────────────────────
# Help
# ──────────────────────────────────────────────

.PHONY: help

help: ## Show this help
	@printf "\n\033[1mTargets:\033[0m\n"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@printf "\n\033[1mVariables:\033[0m\n"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "REGISTRY"       "Container image registry"             "$(REGISTRY)"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "FRONTEND_IMAGE" "Frontend image name"                  "$(FRONTEND_IMAGE)"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "BFF_IMAGE"      "BFF image name"                       "$(BFF_IMAGE)"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "SB_IMAGE"       "Storage backend image name"            "$(SB_IMAGE)"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "CHART_NAME"     "Helm chart name"                      "$(CHART_NAME)"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "VERSION"        "Release version for image-push"       "auto-computed from git tags"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "BUILDER"        "Container build tool"                 "$(BUILDER)"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "IMAGE_TAG"      "Tag for image-build / image-scan"     "$(IMAGE_TAG)"
	@printf "  \033[33m%-20s\033[0m %s (default: %s)\n" "SEVERITY"       "Trivy severity filter for image-scan" "$(SEVERITY)"
	@printf "\n\033[1mExamples:\033[0m\n"
	@printf "  make validate                          # typecheck + lint + test (all)\n"
	@printf "  make image-build                       # build both container images\n"
	@printf "  make image-push VERSION=0.5.0          # build and push with explicit version\n"
	@printf "  make image-scan SEVERITY=MEDIUM        # scan with lower severity threshold\n"
	@printf "  make chart-push                        # package and push Helm chart to OCI registry\n"
	@printf "\n"
