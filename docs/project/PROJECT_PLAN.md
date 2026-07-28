# Brewet Storage Tools — Project Plan

## Overview

Reimplement the Storage Browser, Storage Management, and Settings features from [ODH-TEC](https://github.com/rh-aiservices-bu/odh-tec) as part of the Brewet RHOAI Dashboard community plugin. The plugin allows users to deploy a per-project storage backend (the "Brewet container") with S3 and PVC access, then browse, manage, and transfer files through the dashboard UI.

## Architecture

### Three-Container Model

```text
┌─────────────────────────────────────────────────────────────────┐
│  Cluster-Level (Helm chart)                                     │
│  ┌────────────────────┐   ┌──────────────────────────────────┐  │
│  │  Plugin Frontend   │   │  BFF (Express)                   │  │
│  │  (Nginx, port 8080)│   │  (port 3000)                     │  │
│  │  Module Federation │   │  Proxies data plane to           │  │
│  │  remoteEntry.js    │   │  per-project storage backends    │  │
│  └────────────────────┘   └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Per-Project (created by user via plugin UI)                     │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  Storage Backend (Fastify, port 8888)                       ││
│  │  - S3 operations (via Data Connection env vars)             ││
│  │  - PVC operations (via mounted volumes)                     ││
│  │  - Transfers, HuggingFace import, Settings                  ││
│  │  - NetworkPolicy: only accepts traffic from BFF namespace   ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### API Routing

| Operation Type | Path | Notes |
|---|---|---|
| **Management plane** (CRUD Deployments, list DataConnections/PVCs, start/stop) | Frontend → Dashboard `/api/k8s` → K8s API | Uses existing dashboard proxy; JSON-only, works fine |
| **Data plane** (S3/PVC browse, uploads, downloads, transfers, settings) | Frontend → BFF `/brewet/api/{namespace}/...` → Storage Backend `:8888/api/...` | BFF streams responses; supports SSE, multipart, binary |

### Why BFF is Required (Not K8s Service Proxy)

The RHOAI Dashboard's `/api/k8s` proxy (`odh-dashboard/backend/src/utils/httpUtils.ts`):

- **Buffers entire responses** in memory (`let data = ''; res.on('data', chunk => data += chunk)`) — breaks SSE streaming
- **Sets UTF-8 encoding** on responses — corrupts binary file downloads
- **Serializes request bodies** with `JSON.stringify` — breaks multipart/form-data uploads
- **Adds double proxy overhead** (Dashboard → K8s API → Service)

The BFF provides direct streaming proxy to the storage backend with a single hop.

### Authentication & Security

- **Management plane**: User's Bearer token is forwarded by the dashboard's `/api/k8s` proxy; K8s RBAC enforces permissions.
- **Data plane**: BFF forwards the user's Bearer token to the storage backend. The storage backend has auth disabled (internal-only service). A **NetworkPolicy** restricts incoming traffic to the BFF's namespace only.

### Container Lifecycle

The "Brewet container" (storage backend) deployed per-project consists of:

- **Deployment**: Image `brewet-storage-backend`, with Data Connection env vars (`envFrom: secretRef`) and PVC volume mounts. `LOCAL_STORAGE_PATHS` env var set to comma-separated mount paths.
- **Service**: ClusterIP service on port 8888.
- **NetworkPolicy**: Ingress only from the BFF namespace.

Start/Stop = scale replicas to 1/0. Delete = remove all three resources.

---

## Navigation & Page Structure

```text
RHOAI Dashboard Sidebar
└── Community Plugins (shared section)
    └── Brewet (plugin section)
        ├── Storage (section)
        │   ├── Storage Browser    → /brewet/storage/browse/:locationId?/:path?
        │   └── Storage Management → /brewet/storage/manage
        └── Settings               → /brewet/settings
```

All pages share a **toolbar** at the top containing:

- **Project Selector** (reused from current example, persistent across pages via React Context)
- **Container Status Indicator** + **Start/Stop button** (shows status of Brewet container in selected project)
- **Edit Container Config** button (opens creation wizard in edit mode)

When no Brewet container exists in the selected project, all pages show a **creation prompt** instead of their normal content.

---

## Phases

### Phase 1: Foundation & Project Restructure

**Goal**: Remove example content, establish new navigation/routing structure, and set up shared state management.

**Deliverables**:

1. **Remove example pages and hooks**
   - Delete `UserInfoPage.tsx`, `ClusterResourcesPage.tsx`, `NamespaceSummaryPage.tsx` and their tests
   - Delete `useCurrentUser.ts`, `useK8sResources.ts`, `useAccessReview.ts`, `useNamespaceSummary.ts` and their tests
   - Keep `ProjectSelector.tsx`, `useProjects.ts`, `useFavoriteProjects.ts`, `CommunityBanner.tsx`

2. **Update extensions.ts**
   - Replace three `app.navigation/href` extensions (UserInfo, ClusterResources, NamespaceSummary) with:
     - `app.navigation/section` for "Storage" subsection under `brewet`
     - `app.navigation/href` for "Storage Browser" (`/brewet/storage/browse`)
     - `app.navigation/href` for "Storage Management" (`/brewet/storage/manage`)
     - `app.navigation/href` for "Settings" (`/brewet/settings`)

3. **Create shared context: `BrewetContext`**
   - `BrewetProvider` wrapping the App component
   - State: `selectedProject`, `setSelectedProject`, `containerStatus` (none/stopped/running/starting/error), `containerInfo` (Deployment metadata)
   - `selectedProject` persists in URL query param or localStorage
   - Auto-fetches container status when project changes

4. **Create shared toolbar component: `BrewetToolbar`**
   - Contains `ProjectSelector`, container status badge, Start/Stop toggle, Edit Config button
   - Rendered on all pages above page content

5. **Update App.tsx routing**
   - New routes: `storage/browse/*`, `storage/manage/*`, `settings/*`
   - Default redirect from `/` to `storage/browse`
   - All pages wrapped in `BrewetProvider` and `BrewetToolbar`

6. **Create placeholder pages**
   - `StorageBrowserPage.tsx`, `StorageManagementPage.tsx`, `SettingsPage.tsx` (empty shells with titles)

7. **Update BFF**
   - Remove `namespaceSummary` route and handler
   - Keep health endpoint
   - Prepare route structure for proxy endpoints

8. **Update tests and lint**
   - Remove tests for deleted components
   - Add basic tests for new structure
   - Ensure `npm test` and `npm run lint` pass

**Dependencies**: None (starting point)
**Estimated effort**: 2–3 days

---

### Phase 2: Storage Backend — Core Setup

**Goal**: Create the per-project Fastify server with S3 and local storage APIs, ported from ODH-TEC.

**Deliverables**:

1. **Initialize `storage-backend/` directory**
   - `package.json` with Fastify 4, AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`), `@fastify/multipart`, `@fastify/cors`, `@fastify/helmet`, `p-limit`, `pino`
   - `tsconfig.json` (strict mode, ES2020 target)
   - `.eslintrc.json`
   - `src/server.ts` — entry point (port 8888, CORS, Helmet, multipart, request logging)
   - `src/app.ts` — plugin/route autoloading

2. **Configuration management** (`src/utils/config.ts`)
   - Port from ODH-TEC: mutable module-level config for S3, HuggingFace, proxy, limits
   - `initializeS3Client()` with connection pooling, retry config, proxy support, MD5 checksum middleware
   - `getS3Config()`, `updateS3Config()`, `getHuggingFaceConfig()`, `updateHuggingFaceConfig()`
   - `getProxyConfig()`, `updateProxyConfig()`
   - Read defaults from environment variables (Data Connection pattern)

3. **Local storage utilities** (`src/utils/localStorage.ts`)
   - Port from ODH-TEC: `LOCAL_STORAGE_PATHS` parsing, location ID mapping (`local-0`, `local-1`, ...)
   - `validatePath()` with 11 security checks (traversal, null bytes, symlinks, etc.)
   - `getStorageLocations()` — check each path's availability

4. **File validation** (`src/utils/fileValidation.ts`)
   - Port from ODH-TEC: allowed/blocked extension lists, configurable overrides

5. **Bucket routes** (`src/routes/api/buckets/index.ts`)
   - `GET /api/buckets` — list S3 buckets with access check
   - `POST /api/buckets` — create bucket (with AWS naming validation)
   - `DELETE /api/buckets/:bucketName` — delete bucket

6. **Object routes** (`src/routes/api/objects/index.ts`)
   - `GET /api/objects/:bucketName` — list objects at root
   - `GET /api/objects/:bucketName/:base64prefix` — list with prefix
   - `GET /api/objects/view/:bucketName/:base64key` — preview file inline
   - `GET /api/objects/download/:bucketName/:base64key` — download file (streaming)
   - `POST /api/objects/upload/:bucketName/:base64key` — upload file (multipart, 5MB chunks via `@aws-sdk/lib-storage`)
   - `DELETE /api/objects/:bucketName/:base64key` — delete object
   - `POST /api/objects/folder/:bucketName/:base64key` — create folder (zero-byte object with trailing `/`)

7. **Local file routes** (`src/routes/api/local/index.ts`)
   - `GET /api/local/locations` — list configured storage locations with status
   - `GET /api/local/files/:locationId/:base64path` — list files
   - `GET /api/local/view/:locationId/:base64path` — view file
   - `GET /api/local/download/:locationId/:base64path` — download file (streaming)
   - `POST /api/local/files/:locationId/:base64path` — upload file
   - `DELETE /api/local/files/:locationId/:base64path` — delete file/directory
   - `POST /api/local/directories/:locationId/:base64path` — create directory

8. **Settings routes** (`src/routes/api/settings/index.ts`)
   - `GET/PUT /api/settings/s3` — S3 config
   - `POST /api/settings/test-s3` — test S3 connection
   - `GET/PUT /api/settings/huggingface` — HF token
   - `POST /api/settings/test-huggingface` — test HF connection
   - `GET/PUT /api/settings/proxy` — proxy config
   - `POST /api/settings/test-proxy` — test proxy connectivity
   - `GET/PUT /api/settings/max-concurrent-transfers` — transfer concurrency
   - `GET/PUT /api/settings/max-files-per-page` — pagination

9. **Info route** (`src/routes/api/info/index.ts`)
   - `GET /api/info` — app info/version endpoint

10. **Containerfile** (`storage-backend/Containerfile`)
    - Multi-stage build: UBI9 Node 22 builder → UBI9 Node 22 runtime
    - Non-root (UID 1001), port 8888
    - `npm ci --production` in final stage

11. **Unit tests**
    - Config initialization, path validation, file validation, bucket naming validation
    - Route handler tests with Fastify `inject()`

**Dependencies**: None (can be developed in parallel with Phase 1)
**Estimated effort**: 5–7 days

---

### Phase 3: Storage Backend — Advanced Features

**Goal**: Add transfer system, HuggingFace import, and SSE progress reporting.

**Deliverables**:

1. **Transfer queue** (`src/utils/transferQueue.ts`)
   - Port from ODH-TEC: `TransferQueue` class extending EventEmitter
   - `p-limit` concurrency control (default 2 main, 20 metadata)
   - Job lifecycle: queued → active → completed/failed/cancelled
   - AbortController support for cancellation
   - SSE event throttling (1/second)

2. **Transfer routes** (`src/routes/api/transfer/index.ts`)
   - `POST /api/transfer` — initiate transfer, returns `{ jobId, sseUrl }`
   - `GET /api/transfer/progress/:jobId` — SSE endpoint for real-time progress
   - `GET /api/transfer/:jobId` — get job details
   - `DELETE /api/transfer/:jobId` — cancel transfer
   - `POST /api/transfer/:jobId/cleanup` — delete destination files for cancelled/failed jobs
   - `POST /api/transfer/check-conflicts` — check for file conflicts at destination
   - Support all transfer types: S3→S3, S3→local, local→S3, local→local
   - Recursive directory listing for folder transfers
   - Conflict resolution: overwrite, skip, rename

3. **HuggingFace import** (addition to objects routes)
   - `POST /api/objects/huggingface-import` — import model from HuggingFace Hub
   - SSE progress reporting during download
   - Streaming download to S3 (no full file in memory)

4. **SSE utilities** (`src/utils/sse.ts`)
   - `@fastify/sse-v2` integration
   - Helper for sending progress events with throttling
   - Keep-alive comments to prevent proxy timeouts

5. **Unit tests**
   - Transfer queue state machine
   - Conflict detection logic
   - SSE event formatting

**Dependencies**: Phase 2 (storage backend core)
**Estimated effort**: 3–5 days

---

### Phase 4: BFF Proxy Layer

**Goal**: Refactor the existing BFF to proxy data plane requests from the plugin frontend to per-project storage backends.

**Deliverables**:

1. **Service discovery**
   - BFF uses its ServiceAccount token to query K8s API for the storage backend Service in the target namespace
   - Service naming convention: `brewet-storage-backend` in each project namespace
   - Cache discovered endpoints with TTL (avoid repeated lookups)

2. **Proxy middleware** (`bff/src/routes/storageProxy.ts`)
   - Route pattern: `/api/:namespace/*` — extract namespace, proxy remaining path to `http://brewet-storage-backend.{namespace}.svc.cluster.local:8888/api/{remainingPath}`
   - Forward user's Bearer token from the incoming request
   - Support all HTTP methods (GET, POST, PUT, DELETE, PATCH)

3. **Streaming support**
   - **SSE passthrough**: Detect `Accept: text/event-stream`, pipe response without buffering
   - **File download passthrough**: Detect binary content types, pipe response stream
   - **File upload passthrough**: Detect `Content-Type: multipart/form-data`, pipe request body stream
   - Set `X-Accel-Buffering: no` on streaming responses
   - No body parsing for proxied requests (raw passthrough)

4. **Error handling**
   - 404 when storage backend service not found in namespace
   - 503 when storage backend is unreachable (container stopped)
   - Timeout handling for long-running operations

5. **Health endpoint**
   - Keep existing `GET /api/health`

6. **Replace Express with http-proxy or similar**
   - Consider `http-proxy` or `http-proxy-middleware` for robust streaming proxy
   - Or use Node.js `http.request` for raw pipe-through (more control)

7. **Unit tests**
   - Service discovery mocking
   - Proxy routing tests
   - Error handling tests

**Dependencies**: Phase 2 (storage backend must exist to proxy to)
**Estimated effort**: 3–4 days

---

### Phase 5: Container Lifecycle Management

**Goal**: Build the frontend UI and hooks for creating, configuring, starting, stopping, and deleting the per-project storage backend.

**Deliverables**:

1. **New hooks**
   - `useDataConnections(namespace)` — lists Secrets with label `opendatahub.io/dashboard=true` and annotation `opendatahub.io/connection-type: s3` via `/api/k8s/api/v1/namespaces/{ns}/secrets?labelSelector=opendatahub.io/dashboard=true`
   - `usePVCs(namespace)` — lists PVCs via `/api/k8s/api/v1/namespaces/{ns}/persistentvolumeclaims`
   - `useBrewetContainer(namespace)` — checks for Deployment named `brewet-storage-backend` in namespace, returns status (none/stopped/running/starting/error), provides start/stop/delete actions

2. **Container creation wizard** (`src/app/components/ContainerWizard/`)
   - Multi-step PatternFly Wizard:
     - **Step 1: Data Connection** — Select one Data Connection from the project. Show connection name and endpoint preview. Allow proceeding without one (S3 features disabled).
     - **Step 2: PVC Selection** — Multi-select PVCs. For each selected PVC, show an editable mount path (default: `/opt/app-root/src/{pvc-name}`). At least one PVC or Data Connection required.
     - **Step 3: Review & Create** — Summary of selections. Confirm button.
   - On submit: create Deployment (with `envFrom`, volumes, volumeMounts, `LOCAL_STORAGE_PATHS`), Service, and NetworkPolicy via `/api/k8s`
   - Progress feedback: show creation status for each resource
   - Edit mode: pre-populate wizard with existing Deployment spec, update on submit

3. **Container status indicator** (in `BrewetToolbar`)
   - Badge showing: "No Container", "Stopped", "Starting", "Running", "Error"
   - Start/Stop toggle button (scales replicas 0↔1)
   - Edit Config button (opens wizard in edit mode)
   - Delete button (with confirmation modal)

4. **Empty state component** (`ContainerRequired`)
   - Shown on all pages when no Brewet container exists in the selected project
   - PatternFly EmptyState with description and "Create Container" action button
   - Also shown when container exists but is stopped, with "Start" button and explanation

5. **Unit tests**
   - Hook tests with mocked API calls
   - Wizard step navigation tests
   - Status indicator rendering tests

**Dependencies**: Phase 1 (project restructure, BrewetContext)
**Estimated effort**: 5–6 days

---

### Phase 6: Storage Service Abstraction & Storage Management Page

**Goal**: Create the frontend storage service layer and the Storage Management page.

**Deliverables**:

1. **Storage service abstraction** (`src/app/services/storageService.ts`)
   - Port from ODH-TEC's `storageService.ts`
   - Unified API for S3 and local storage operations
   - All calls go through BFF: `/brewet/api/{namespace}/buckets`, `/brewet/api/{namespace}/objects/...`, `/brewet/api/{namespace}/local/...`
   - Namespace injected from `BrewetContext`
   - Methods: `getLocations()`, `refreshLocations()`, `createBucket()`, `deleteBucket()`, `listFiles()`, `uploadFile()`, `downloadFile()`, `deleteFile()`, `createFolder()`, `viewFile()`, `getSettings()`, `updateSettings()`, `testConnection()`, `initiateTransfer()`, `checkConflicts()`

2. **API client setup** (`src/app/services/apiClient.ts`)
   - Axios instance configured with base URL `/brewet/api`
   - Interceptor to inject namespace from context
   - Error handling (401 → re-auth, 503 → container not running)

3. **Storage Management page** (`src/app/pages/StorageManagementPage.tsx`)
   - Port from ODH-TEC's `Buckets.tsx`
   - PatternFly Table with columns: Type (S3 icon / PVC icon), Name, Created, Status
   - Sortable columns
   - Create Bucket button (modal with name input and AWS naming validation)
   - Delete Bucket button (confirmation modal requiring name re-typing)
   - Click row → navigate to Storage Browser for that location
   - Refresh button
   - Uses `storageService.getLocations()` which fetches from both `/api/buckets` and `/api/local/locations`

4. **Unit tests**
   - storageService method tests
   - StorageManagementPage rendering and interaction tests

**Dependencies**: Phase 4 (BFF proxy), Phase 5 (BrewetContext with namespace)
**Estimated effort**: 3–4 days

---

### Phase 7: Storage Browser Page — Core

**Goal**: Implement the main file browsing experience with navigation, listing, and basic file operations.

**Deliverables**:

1. **StorageBrowser component** (`src/app/components/StorageBrowser/StorageBrowser.tsx`)
   - Port from ODH-TEC
   - URL routing: `/brewet/storage/browse/:locationId?/:path?`
   - `locationId`: plain text (S3 bucket name or `local-0`, `local-1`)
   - `path`: base64-encoded (handles special characters in file paths)

2. **Location selector**
   - Dropdown or sidebar listing all storage locations (S3 buckets + PVC locations)
   - Icons: CloudIcon for S3, FolderIcon for PVC
   - Clicking a location navigates to its root

3. **Breadcrumb navigation**
   - Shows current path as clickable breadcrumbs
   - Each segment navigates to that prefix

4. **File listing table**
   - PatternFly Table: Name (with icon), Last Modified, Size, Actions
   - Folders first, then files, alphabetically sorted
   - Click folder → navigate into it
   - Click file → preview (or download)
   - Action column: Download, Delete, (more in Phase 8)

5. **Pagination**
   - S3: continuation token-based pagination
   - Local: offset/limit pagination
   - Page size from settings (`max-files-per-page`)
   - Previous/Next controls

6. **Search/Filter**
   - Filter input above the table
   - Two modes: `startsWith` (prefix match, server-side for S3) and `contains` (client-side filter)
   - Toggle between modes

7. **File upload**
   - Upload button → file picker (multiple files)
   - Drag-and-drop zone over the file listing
   - Progress indicator per file
   - Upload via `storageService.uploadFile()` → BFF → storage backend multipart upload

8. **File download**
   - Click download action → browser downloads file
   - Via `storageService.downloadFile()` → BFF → storage backend streaming response

9. **Delete files/folders**
   - Single delete via action button (confirmation modal)
   - Folder delete: recursive deletion with warning

10. **Create folder**
    - Button in toolbar → modal with folder name input
    - Creates zero-byte S3 object with trailing `/` or `mkdir` for local

11. **Unit tests**
    - Navigation tests
    - File listing rendering
    - Upload/download/delete interaction tests

**Dependencies**: Phase 6 (storageService)
**Estimated effort**: 5–7 days

---

### Phase 8: Storage Browser — Advanced Features

**Goal**: Add file preview, multi-select bulk operations, and HuggingFace import.

**Deliverables**:

1. **File preview / DocumentRenderer**
   - Port from ODH-TEC
   - Preview pane or modal for supported file types:
     - JSON (syntax-highlighted)
     - YAML (syntax-highlighted)
     - Markdown (rendered)
     - Plain text
     - Images (inline display)
   - Fallback: "Download to view" for unsupported types
   - Uses `storageService.viewFile()` to fetch content inline

2. **Multi-select with checkboxes**
   - Checkbox column in file listing table
   - Select all / deselect all
   - Bulk action toolbar appears when items selected:
     - Bulk delete (with confirmation)
     - Transfer to... (opens transfer flow, Phase 9)

3. **HuggingFace model import**
   - Import button in toolbar (when in S3 location)
   - Modal: enter HuggingFace model ID (e.g., `meta-llama/Llama-2-7b`)
   - Optional: select specific files from the model repo
   - Progress tracking via SSE
   - Import via `POST /api/objects/huggingface-import` through BFF

4. **Unit tests**
   - DocumentRenderer tests
   - Multi-select behavior
   - HF import modal

**Dependencies**: Phase 7 (core browser)
**Estimated effort**: 3–4 days

---

### Phase 9: Transfer System

**Goal**: Implement cross-storage transfer functionality with real-time progress.

**Deliverables**:

1. **Transfer initiation flow**
   - "Transfer to..." action on selected files/folders
   - Destination picker:
     - Select target storage type (S3 or PVC)
     - Select target location (bucket or local location)
     - Optional: select target path (browse destination)

2. **Conflict detection**
   - Before transfer: call `storageService.checkConflicts()` with source and destination
   - Display conflicts in a modal
   - Resolution options per conflict: Overwrite, Skip, Rename (auto-suffix)
   - Apply resolution to all conflicts option

3. **Transfer progress component** (`src/app/components/Transfer/TransferProgress.tsx`)
   - SSE connection to BFF → storage backend progress endpoint
   - Real-time progress: file count, bytes transferred, current file, speed
   - Progress bar with percentage
   - Cancel button (sends DELETE to cancel transfer)
   - Completion summary

4. **EventEmitter integration** (`src/app/utils/emitter.ts`)
   - Port from ODH-TEC: EventEmitter3 for cross-component communication
   - Events: `transfer:started`, `transfer:progress`, `transfer:completed`, `transfer:cancelled`
   - Storage Browser refreshes its listing on `transfer:completed` if the destination is the current location

5. **Transfer types supported**
   - S3 → S3 (within same backend)
   - S3 → PVC
   - PVC → S3
   - PVC → PVC

6. **Unit tests**
   - Destination picker rendering
   - Conflict modal interactions
   - Progress component with mocked SSE

**Dependencies**: Phase 3 (storage backend transfer routes), Phase 7 (browser for source selection)
**Estimated effort**: 4–5 days

---

### Phase 10: Settings Page

**Goal**: Implement the full settings interface with all configuration tabs.

**Deliverables**:

1. **Settings page layout** (`src/app/pages/SettingsPage.tsx`)
   - PatternFly Tabs component with 5 tabs
   - All settings calls go through storageService → BFF → storage backend
   - Settings are per-container (ephemeral, override env vars in memory)

2. **S3 Storage tab**
   - Fields: Endpoint URL, Access Key ID, Secret Access Key (masked), Region, Default Bucket
   - Pre-populated from current config
   - Save button → `PUT /api/settings/s3`
   - Test Connection button → `POST /api/settings/test-s3` → shows success/failure alert

3. **HuggingFace tab**
   - Field: API Token (masked)
   - Save button → `PUT /api/settings/huggingface`
   - Test Connection button → `POST /api/settings/test-huggingface` → shows username on success

4. **Proxy tab**
   - Fields: HTTP Proxy, HTTPS Proxy, Test URL
   - Save button → `PUT /api/settings/proxy`
   - Test Connection button → `POST /api/settings/test-proxy` → shows response status

5. **Transfer Controls tab**
   - Slider: Max concurrent transfers (1–10, default 2)
   - Immediate effect via `PUT /api/settings/max-concurrent-transfers`

6. **Pagination tab**
   - Slider: Max files per page (10–500, default 100)
   - Save → `PUT /api/settings/max-files-per-page`

7. **Unit tests**
   - Tab rendering and switching
   - Form validation
   - Test connection flow

**Dependencies**: Phase 6 (storageService)
**Estimated effort**: 2–3 days

---

### Phase 11: Helm Chart, Deployment & CI/CD

**Goal**: Update infrastructure for the new three-container architecture.

**Deliverables**:

1. **Helm chart updates**
   - **Rename existing BFF templates**: `bff-deployment.yaml` → keep as is (BFF is the proxy)
   - **Add storage backend image reference** in `values.yaml` (used by the plugin UI when creating per-project Deployments — the image tag is injected as a config value, not deployed by the chart itself)
   - **Add BFF RBAC**: ServiceAccount + ClusterRole + ClusterRoleBinding for the BFF to:
     - `get` Services in any namespace (to verify the storage backend service exists before routing)
     - **Note**: Only `get` is required — not `proxy`. The BFF uses direct DNS routing
       (`http://brewet-storage-backend.{namespace}.svc.cluster.local:8888`) rather than the
       K8s API Server's service proxy endpoint. Direct DNS is simpler, lower latency, and
       avoids routing data-plane traffic through the API Server, following the principle of
       least privilege.
   - **Add NetworkPolicy template** (optional, deployable as a reference for users): allows ingress to storage backend only from BFF namespace

2. **BFF Containerfile update** (`bff/Containerfile`)
   - Ensure streaming proxy dependencies are included
   - Update if Express is replaced with a more streaming-friendly approach

3. **Storage backend Containerfile** (`storage-backend/Containerfile`)
   - Multi-stage UBI9 Node 22 build
   - Non-root UID 1001, port 8888
   - Production dependencies only

4. **Build scripts**
   - Update `scripts/build-push.sh` to handle three images: frontend, BFF, storage-backend
   - Update `scripts/sync-chart-version.js` to sync version into `storage-backend/package.json`

5. **CI/CD workflows**
   - Update `.github/workflows/ci.yml`: add storage-backend test and lint jobs
   - Update `.github/workflows/build-push.yml`: build and push storage-backend image
   - Add `quay.io/rh-ai-community-plugins/brewet-storage-backend` image target

6. **Environment configuration**
   - Update `.env.development` with storage backend dev settings
   - Document environment variables for the storage backend

7. **Plugin manifest** (`plugin.yaml`)
   - Add storage backend image reference
   - Update feature description

**Dependencies**: Phase 2 (storage backend exists), Phase 4 (BFF refactored)
**Estimated effort**: 3–4 days

---

### Phase 12: Testing, Polish & Documentation

**Goal**: Comprehensive testing, UX polish, and documentation updates.

**Deliverables**:

1. **Integration testing**
   - End-to-end flow: create container → browse storage → upload file → download → delete → transfer
   - Test with real S3 (MinIO) and PVC volumes
   - Test start/stop/delete container lifecycle

2. **UX polish**
   - Loading states and skeleton screens on all pages
   - Error boundaries with meaningful messages
   - Empty states with helpful guidance
   - Responsive layout for smaller viewports
   - Keyboard navigation and accessibility (a11y)
   - Consistent iconography across S3/PVC/folder/file types

3. **Edge cases and error handling**
   - Container not found (was deleted externally)
   - Container in error state (CrashLoopBackOff)
   - S3 connection failure (invalid credentials)
   - PVC not mounted / not readable
   - Large file upload interruption and resume
   - Network timeout handling
   - Concurrent user access to same container

4. **Documentation updates**
   - Update `AGENTS.md` with new architecture
   - Update `docs/architecture/` with storage system docs
   - Update `docs/development/` with local setup for all three components
   - Update `docs/deployment/` with per-project container creation guide
   - Add `docs/project/` with this plan and architecture decision records

5. **Update `README.md`**
   - New feature description
   - Updated architecture diagram
   - New screenshots

**Dependencies**: All previous phases
**Estimated effort**: 3–5 days

---

## Summary

| Phase | Description | Effort | Dependencies |
|---|---|---|---|
| 1 | Foundation & Project Restructure | 2–3 days | — |
| 2 | Storage Backend — Core Setup | 5–7 days | — |
| 3 | Storage Backend — Advanced Features | 3–5 days | Phase 2 |
| 4 | BFF Proxy Layer | 3–4 days | Phase 2 |
| 5 | Container Lifecycle Management | 5–6 days | Phase 1 |
| 6 | Storage Service & Management Page | 3–4 days | Phases 4, 5 |
| 7 | Storage Browser — Core | 5–7 days | Phase 6 |
| 8 | Storage Browser — Advanced | 3–4 days | Phase 7 |
| 9 | Transfer System | 4–5 days | Phases 3, 7 |
| 10 | Settings Page | 2–3 days | Phase 6 |
| 11 | Helm Chart, Deployment & CI/CD | 3–4 days | Phases 2, 4 |
| 12 | Testing, Polish & Documentation | 3–5 days | All |
| **Total** | | **42–57 days** | |

### Parallelization Opportunities

Phases 1 and 2 can run in parallel (frontend cleanup vs. backend development).
Phase 5 can start as soon as Phase 1 is done, independent of Phase 2.
Phases 6, 10, and 11 can partially overlap.
Phase 12 is incremental and can start during Phase 7.

### Critical Path

Phase 2 → Phase 3 → Phase 4 → Phase 6 → Phase 7 → Phase 8/9 → Phase 12

---

## Open Questions & Future Considerations

1. **Storage backend image versioning**: How should the storage backend image tag be managed relative to the plugin version? Should they be locked together or independent?

2. **Multi-container creation**: Should the plugin support multiple Brewet containers per project (e.g., different S3 endpoints)?

3. **Resource limits**: What CPU/memory requests/limits should be set on the per-project storage backend Deployment?

4. **RBAC requirements**: Users need permission to create Deployments, Services, and NetworkPolicies in their project. Should the plugin check these permissions upfront and show appropriate messages?

5. **Upgrade path**: When a new storage backend image is released, how should existing per-project containers be updated? Auto-update vs. manual?

6. **Quota impact**: The per-project container consumes namespace quota. Should the plugin warn users about this?

7. **Data Connection discovery**: Confirm the exact label/annotation selectors for Data Connections in the targeted RHOAI versions. The current assumption is `opendatahub.io/dashboard=true` label with `opendatahub.io/connection-type: s3` annotation.
