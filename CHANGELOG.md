# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Development best practices guide (`docs/development/BEST_PRACTICES.md`) covering storage backend, BFF, frontend, Helm, security, and cross-component patterns
- Testing guide (`docs/development/TESTING.md`) with contract testing principles and integration test scenarios
- `[PLUGIN-SPECIFIC]` annotations in `plugin.yaml` for customizable fields

### Changed

- Expanded `CONTRIBUTING.md` with three-component dev setup instructions
- Added integration pattern summary table to `README.md`
- Backfilled `CHANGELOG.md` with all phases

## [0.1.0] - 2026-07-22

Initial development release of the Brewet plugin, implementing 11 phases from the project plan.

### Added — Phase 1: Foundation & Project Restructure

- Restructured the hello-world seed plugin for storage management
- Three-container architecture: Plugin Frontend, BFF, Storage Backend
- `BrewetContext` with project selector, container status, and persistent toolbar
- Container lifecycle management (create, start/stop, edit, delete)
- Navigation structure: Storage Browser, Storage Management, Settings
- Branching strategy (`main` / `dev` / feature branches)

### Added — Phase 2: Storage Backend Core Setup

- Fastify 4 server ported from ODH-TEC with S3 (AWS SDK v3) and PVC (Node.js `fs`) operations
- S3 routes: list buckets, list objects, upload, download, delete, create folder, head object
- Local/PVC routes: list locations, list files, upload, download, delete, create directory
- 11 security checks for path traversal prevention (null bytes, symlinks, Unicode normalization)
- File validation with allowed/blocked extension lists
- Settings routes for S3, HuggingFace, proxy, transfer concurrency, and pagination config
- MD5 checksum middleware for S3 upload integrity
- Connection pooling and retry configuration for AWS SDK v3

### Added — Phase 3: Transfer System & HuggingFace Import (Storage Backend)

- `TransferQueue` with `p-limit` concurrency control, SSE progress, and abort support
- Transfer routes: S3↔S3, S3↔PVC, PVC↔PVC with conflict detection
- HuggingFace import: streaming download-to-S3 with SSE progress
- Transfer cleanup with destination tracking and partial file deletion on abort
- Multipart copy for S3 objects exceeding 5 GB
- URL-safe base64 encoding for file paths in URLs

### Added — Phase 4: BFF Proxy Layer

- Express proxy routing: `/api/:namespace/*` → storage backend at `:8888/api/...`
- Streaming support for SSE, file downloads, and binary responses
- Service discovery via K8s API with in-flight deduplication and TTL cache
- Rate limiting per client
- Proxy header sanitization (strips and rewrites `x-forwarded-*` headers)
- Graceful shutdown handling for SIGTERM
- Health endpoint at `/healthz`
- Typed `K8sHttpError` for structured error classification
- Namespace validation against K8s naming regex

### Added — Phase 5: Container Lifecycle Management

- Creation wizard: select Data Connection (S3 credentials) + PVCs to mount
- Start/Stop via Deployment replica scaling (1/0)
- Edit configuration (update Data Connection, PVCs)
- Delete container (removes Deployment, Service, NetworkPolicy)
- Container status polling with status indicator in the persistent toolbar

### Added — Phase 6: Storage Service & Management Page

- Storage service abstraction layer for frontend API calls
- Storage Management page: table of all storage locations (S3 buckets + PVC locations)
- Create and delete S3 buckets from the management page
- Unified error handling with `handleResponse` utility
- Bucket name validation aligned between frontend and backend

### Added — Phase 7: Storage Browser (Core)

- Unified S3 + PVC file browser with breadcrumb navigation
- Upload files (streaming through BFF proxy)
- Download files with correct MIME types
- Delete files and folders
- Create folders in S3 and PVC locations
- Pagination with configurable page size (synced with backend `maxFilesPerPage` setting)
- Search with prefix-based (S3) and client-side contains filtering
- Error handling for download and refresh operations

### Added — Phase 8: Storage Browser (Advanced Features)

- File preview with `DocumentRenderer` supporting text, images, JSON, YAML, Markdown, CSV
- Multi-select with checkboxes and bulk delete with recursive-deletion warnings
- HuggingFace model import modal with SSE progress streaming
- Abort race guard in `DocumentRenderer` to prevent stale previews
- Named SSE event listeners (`addEventListener`) instead of `onmessage`

### Added — Phase 9: Transfer System (Frontend)

- Transfer modal with source/destination location selection
- Real-time SSE progress streaming through BFF proxy
- Transfer cancellation with partial file cleanup
- Conflict detection and overwrite confirmation
- Polling fallback when SSE connection drops
- `mountedRef` guard to prevent state updates on unmounted components

### Added — Phase 10: Settings Page

- Tabbed settings page: S3, HuggingFace, Proxy, Transfer, Pagination
- Runtime configuration overrides (ephemeral per container restart)
- `useSettingsTab` hook extracted to reduce duplication across tabs
- AbortController cleanup on namespace change
- URL format validation for proxy test URL
- PatternFly 6 `AlertActionCloseButton` for dismiss pattern

### Added — Phase 11: Helm Chart, Deployment & CI/CD

- Helm chart (`chart/`) deploying frontend and BFF to Kubernetes
- Three multi-stage Containerfiles (UBI9 Node 22 builder → UBI9 runtime)
- Frontend: Nginx 1.24 serving `dist/` on port 8080 as UID 1001
- BFF: Node 22 runtime on port 3000 as UID 1001
- Storage backend: Node 22 runtime on port 8888 as UID 1001
- GitHub Actions CI workflow (tests + lint for all three components)
- GitHub Actions build-push workflow (manual trigger, pushes to Quay.io)
- `build-push.sh` script for building and pushing all three container images
- `scan-image.sh` script for Trivy vulnerability scanning with `--exit-code 1` gating
- `sync-chart-version.js` for version sync across `package.json`, `Chart.yaml`, `bff/package.json`, `storage-backend/package.json`, `plugin.yaml`, and `.env.development`
- `plugin.yaml` unified manifest for Module Federation config and community plugin catalog
- Consistent component labels across all Helm templates

### Fixed

- AbortController cleanup in hooks (`useCurrentUser`, `useProjects`, `useNamespaceSummary`)
- URL-safe base64 encoding to prevent Fastify route param breakage
- `formatBytes` guard against fractional byte values
- Sync-chart-version regex preventing corruption of `k8sResources.ts`
- Node.js version updated to 22 in CI to match Containerfiles

[Unreleased]: https://github.com/rh-ai-community-plugins/brewet/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rh-ai-community-plugins/brewet/releases/tag/v0.1.0
