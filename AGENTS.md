# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Brewet** (`rhoai-brewet`) is a community plugin for the **Red Hat OpenShift AI (RHOAI) Dashboard** that provides S3 and PVC storage management. It reimplements the storage features of [ODH-TEC](https://github.com/rh-aiservices-bu/odh-tec) as a dashboard plugin with per-project container lifecycle management.

The plugin uses Webpack 5 Module Federation to expose remote modules that the RHOAI dashboard loads at runtime.

### Project Status

The project is being built from a seed scaffold. The implementation plan is at `docs/project/PROJECT_PLAN.md`. Example pages from the seed (UserInfo, ClusterResources, NamespaceSummary) are to be removed and replaced with the storage features described below.

### Three-Container Architecture

| Component | Directory | Port | Scope | Role |
|---|---|---|---|---|
| **Plugin Frontend** | `src/` | 8080 | Cluster-level (Helm) | React/PF6 UI served by Nginx as Module Federation remote |
| **BFF** | `bff/` | 3000 | Cluster-level (Helm) | Express proxy routing data-plane requests to per-project storage backends |
| **Storage Backend** | `storage-backend/` | 8888 | Per-project (user-created) | Fastify API with S3 (AWS SDK v3) and PVC (Node.js fs) operations |

### API Routing

- **Management plane** (create/start/stop containers, list Data Connections, list PVCs): Frontend → Dashboard `/api/k8s` proxy → K8s API. Standard JSON operations; the dashboard's K8s proxy handles these fine.
- **Data plane** (file browse, upload, download, transfers, settings): Frontend → BFF `/brewet/api/{namespace}/...` → Storage Backend `:8888/api/...`. The BFF streams responses (SSE, binary, multipart). The dashboard's `/api/k8s` proxy cannot be used for the data plane because it buffers entire responses, sets UTF-8 encoding (corrupts binary), and stringifies request bodies (breaks multipart uploads).

### Security Model

- The storage backend has no app-level authentication (internal-only service).
- A **NetworkPolicy** restricts storage backend ingress to the BFF namespace only.
- The BFF forwards the user's Bearer token from the dashboard.
- Management-plane operations rely on K8s RBAC via the dashboard's `/api/k8s` proxy.

## Navigation & Pages

```
RHOAI Dashboard Sidebar
└── Community Plugins
    └── Brewet
        ├── Storage (section)
        │   ├── Storage Browser    → /brewet/storage/browse/:locationId?/:path?
        │   └── Storage Management → /brewet/storage/manage
        └── Settings               → /brewet/settings
```

All pages share a persistent **toolbar** with: Project Selector, Container Status + Start/Stop button, Edit Config button. The selected project persists across page navigation via React Context (`BrewetContext`).

### Feature Summary

- **Storage Browser**: Unified S3 + PVC file browser with upload, download, delete, create folder, file preview, HuggingFace import, search, pagination, multi-select, and cross-storage transfers.
- **Storage Management**: Table of all storage locations (S3 buckets + PVC locations) with create/delete bucket operations.
- **Settings**: Tabbed config for S3, HuggingFace, proxy, transfer concurrency, and pagination. Runtime overrides, ephemeral per container restart.
- **Container Lifecycle**: Creation wizard (select Data Connection + PVCs), start/stop/edit/delete per-project storage backend.

## Branching Strategy

- **`main`** — Release branch. Always in a releasable state.
- **`dev`** — Development branch. All feature branches are created from `dev` and merged back into `dev`.
- **Feature branches** — Named `feat/<description>` (e.g., `feat/phase-1-foundation`). One per phase or logical unit of work.
- **Release flow** — When `dev` accumulates enough features for a release, it is PRed to `main`.

## Build & Development Commands

```bash
npm run start:dev     # Dev server on port 9500 with HMR
npm run build         # Production build to dist/
npm test              # Run all tests (Jest + jsdom)
npm run test:watch    # Watch mode
npm run test:coverage # Tests with coverage report
npm run lint          # ESLint on src/ + markdownlint on **/*.md
```

To run a single test file:

```bash
npx jest src/app/hooks/useProjects.spec.ts
```

### BFF Service Commands

```bash
cd bff
K8S_API_BASE=$(oc whoami --show-server) npm run start:dev  # Dev server on port 3000 (K8S_API_BASE required for local dev)
npm run build         # Compile TypeScript to dist/
npm start             # Run compiled server (in-cluster, K8S_API_BASE not needed)
npm test              # Run BFF tests (Jest + node)
npm run lint          # ESLint on bff/src/
```

### Storage Backend Commands

```bash
cd storage-backend
npm run start:dev     # Fastify dev server on port 8888
npm run build         # Compile TypeScript to dist/
npm start             # Run compiled server
npm test              # Run tests (Jest + node)
npm run lint          # ESLint on storage-backend/src/
```

## Architecture Details

### Module Federation Plugin System

The plugin exposes two remote modules via Webpack Module Federation (configured in `config/webpack.common.js`):

- **`./extensions`** (`src/rhoai/extensions.ts`) — Extension points registering the feature area, navigation sections/items, and route.
- **`./Icon`** (`src/app/components/BrewetNavIcon.tsx`) — SVG icon for the plugin's nav subsection.

Shared singletons (react, react-dom, react-router-dom, @patternfly/react-core, @openshift/dynamic-plugin-sdk) are provided by the host and not bundled into the plugin.

### Entry Point Chain

`src/index.ts` → dynamic import → `src/bootstrap.tsx` (React 18 root render). The dynamic import is required for Module Federation to resolve shared dependencies before the app renders.

### Storage Backend (ODH-TEC Heritage)

The storage backend in `storage-backend/` is a Fastify 4 server ported from [ODH-TEC](https://github.com/rh-aiservices-bu/odh-tec). Key subsystems:

- **S3 operations**: AWS SDK v3 with connection pooling, retry config, proxy support, MD5 checksum middleware. Routes under `/api/buckets` and `/api/objects`.
- **Local/PVC operations**: Node.js `fs` with 11 security checks (path traversal prevention, null bytes, symlinks, etc.). Routes under `/api/local`.
- **Transfers**: `TransferQueue` class with `p-limit` concurrency control, SSE progress, abort support. Routes under `/api/transfer`. Supports S3↔S3, S3↔PVC, PVC↔PVC.
- **HuggingFace import**: Streaming download-to-S3 with SSE progress. Route at `POST /api/objects/import-hf`.
- **Settings**: Mutable in-memory config overriding env var defaults. Routes under `/api/settings` for S3, HuggingFace, proxy, transfer concurrency, pagination.
- **File validation**: Allowed/blocked extension lists.
- **URL encoding**: `locationId` is plain text; file paths are base64-encoded in URLs.

The storage backend runs per-project with:
- S3 credentials injected from a Data Connection (K8s Secret with `opendatahub.io/dashboard=true` label) as env vars (`AWS_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `AWS_S3_BUCKET`)
- PVCs mounted as volumes, paths configured via `LOCAL_STORAGE_PATHS` env var

### BFF Proxy

The BFF in `bff/` is an Express server that proxies data-plane requests to per-project storage backends:
- Route pattern: `/api/:namespace/*` → `http://brewet-storage-backend.{namespace}.svc.cluster.local:8888/api/{remainingPath}`
- Supports streaming (SSE, file downloads), multipart uploads, and binary responses
- Forwards the user's Bearer token
- Discovers storage backend services via K8s API using its ServiceAccount

### Container Lifecycle

The "Brewet container" deployed per-project consists of:
- **Deployment**: `brewet-storage-backend` image with Data Connection `envFrom` and PVC `volumeMounts`
- **Service**: ClusterIP on port 8888
- **NetworkPolicy**: Ingress only from BFF namespace

Start/Stop = scale replicas 1/0. Created and managed via dashboard `/api/k8s` proxy from the frontend.

### Plugin Registration

`plugin.yaml` at the repo root is a unified flat manifest serving as both Module Federation runtime config (consumed by the RHOAI dashboard) and community plugin catalog metadata (consumed by the charter registry).

### Webpack Configs

- `config/webpack.common.js` — Shared config: entry point, loaders, Module Federation, path alias `~` → `./src`
- `config/webpack.dev.js` — Dev server on port 9500, proxies `/brewet/api` to BFF at `localhost:3000` and `/brewet` to dashboard at `localhost:8443`
- `config/webpack.prod.js` — Output to `dist/`, CSS extraction, vendor chunk splitting

### Test Setup

Jest with `ts-jest` preset and `jsdom` environment (`jest.config.js`). `jest.setup.tsx` mocks `react-router-dom` (useNavigate, useParams, useLocation, Outlet, Routes, Route, Navigate) and polyfills TextEncoder/TextDecoder. CSS modules are proxied to return property names as class names (`jest.style-mock.js`).

### Scripts

- `scripts/build-push.sh` — Builds and pushes container images (frontend, BFF, storage-backend) to Quay.io.
- `scripts/scan-image.sh` — Builds container images locally and scans them for vulnerabilities using Trivy.
- `scripts/sync-chart-version.js` — Syncs the version from root `package.json` into `chart/Chart.yaml`, `bff/package.json`, `storage-backend/package.json`, and `plugin.yaml`.

### Deployment

- **Frontend container**: Multi-stage build in `Containerfile` — UBI9 Node 22 builder → UBI9 Nginx 1.24 serving `dist/` on port 8080 as UID 1001.
- **BFF container**: Multi-stage build in `bff/Containerfile` — UBI9 Node 22 builder → UBI9 Node 22 runtime on port 3000 as UID 1001.
- **Storage backend container**: Multi-stage build in `storage-backend/Containerfile` — UBI9 Node 22 builder → UBI9 Node 22 runtime on port 8888 as UID 1001.
- **Helm chart**: `chart/` deploys frontend and BFF to Kubernetes. Storage backend image tag is referenced in values for the plugin UI to use when creating per-project Deployments.

### CI/CD Workflows

- `.github/workflows/ci.yml` — Runs tests and lint for frontend, BFF, and storage backend on push/PR to main.
- `.github/workflows/build-push.yml` — Builds and pushes all three container images to Quay.io. Manually triggered via `workflow_dispatch`.

## Documentation

```text
docs/project/        — Project plan and architecture decisions
docs/architecture/   — Plugin system internals and extension contract
docs/development/    — Local dev setup and dashboard API reference
docs/deployment/     — OpenShift deployment with Helm and dashboard registration
```

## Key Conventions

- Path alias: `~` maps to `./src` (webpack) and `@` maps to `./src` (jest). Use `~` in source code imports.
- UI components use **PatternFly 6** (`@patternfly/react-core`, `@patternfly/react-icons`, `@patternfly/react-table`).
- TypeScript strict mode is enabled. Target is ES2020 with ESNext modules and `react-jsx` transform.
- No standalone ESLint config file — uses `@typescript-eslint` defaults via dev dependencies.
- See `docs/development/CUSTOMIZATION.md` for the plugin identifier reference.
- `CommunityBanner` component must not be removed — required for community plugins.
