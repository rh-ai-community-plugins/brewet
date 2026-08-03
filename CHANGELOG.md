# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-08-03

### Changed

- HuggingFace imports now preserve the `owner/model` hierarchy as nested folders instead of flattening to `owner_model` — models are organized by owner for easier navigation on both S3 and PVC storage

## [0.1.1] - 2026-07-29

### Added

- Configurable file type validation with a new **File Types** tab in Settings
  - Allowed and blocked file extension lists are now editable at runtime
  - Supports glob/wildcard patterns (e.g., `.p*` matches `.py`, `.pl`, `.php`; `*` matches any extension)
  - Settings persist in the `brewet-storage-backend-settings` K8s Secret via `ALLOWED_FILE_EXTENSIONS` and `BLOCKED_FILE_EXTENSIONS` environment variables
  - Leave fields empty to use the built-in defaults
- BFF `/api/config` endpoint exposing the BFF's namespace for runtime discovery

### Fixed

- `.py` files can now be uploaded (moved from blocked to allowed in the default extension list)
- Storage locations now shown when S3 is connected but no buckets exist yet, with a link to Storage Management ([#203](https://github.com/rh-ai-community-plugins/brewet/issues/203))
- NetworkPolicy now references the actual BFF namespace instead of the hardcoded default, fixing storage backend connectivity when the plugin is deployed to a custom namespace

### Changed

- Decomposed `StorageBrowser` component from ~1500 lines into focused sub-components and hooks ([#117](https://github.com/rh-ai-community-plugins/brewet/issues/117)):
  - Extracted `useStorageLocations` and `useFileList` custom hooks
  - Extracted `DeleteConfirmationModal`, `CreateFolderModal`, `BulkDeleteConfirmationModal`, `UploadModal`, `FileTable`, `LocationToolbar`, and `StorageBrowserToolbar` components
  - Main component reduced to 499 lines with no behavior changes
- BFF namespace for NetworkPolicy is now resolved at runtime from the BFF instead of being baked in at build time

## [0.1.0] - 2026-07-27

Initial release of the Brewet plugin, providing S3 and PVC storage management for the Red Hat OpenShift AI Dashboard.

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
- Deployment progress feedback in wizard with 409 conflict handling
- Start/Stop via Deployment replica scaling (1/0)
- Edit configuration (update Data Connection, PVCs)
- Delete container (removes Deployment, Service, NetworkPolicy, settings Secret)
- Container status polling with status indicator in the persistent toolbar
- Create Project modal with resource-name auto-derivation and optimistic list update

### Added — Phase 6: Storage Service & Management Page

- Storage service abstraction layer for frontend API calls
- Storage Management page: table of all storage locations (S3 buckets + PVC locations)
- Create and delete S3 buckets from the management page
- Unified error handling with `handleResponse` utility
- Bucket name validation aligned between frontend and backend

### Added — Phase 7: Storage Browser (Core)

- Unified S3 + PVC file browser with breadcrumb navigation
- MultipleFileUpload modal supporting files and folders
- Download files with correct MIME types
- Type-to-confirm safety prompt for file and folder deletion
- Create folders in S3 and PVC locations
- Pagination with configurable page size (synced with backend `maxFilesPerPage` setting)
- Search with prefix-based (S3) and client-side contains filtering
- Copy-to-clipboard button next to the breadcrumb path
- Folder icon as breadcrumb root for navigating back to location root
- Location persistence across page navigation via localStorage
- Error handling for download and refresh operations

### Added — Phase 8: Storage Browser (Advanced Features)

- File preview with `DocumentRenderer` supporting text, images, JSON, YAML, Markdown, CSV
- Multi-select with checkboxes and bulk delete with recursive-deletion warnings
- HuggingFace model import modal with SSE progress streaming and cancel support
- Abort race guard in `DocumentRenderer` to prevent stale previews
- Named SSE event listeners (`addEventListener`) instead of `onmessage`

### Added — Phase 9: Transfer System (Frontend)

- Transfer modal with source/destination location selection and subfolder browser
- Move semantics (delete source files after transfer)
- Real-time SSE progress streaming through BFF proxy
- Transfer cancellation with partial file cleanup
- Cancel support for in-progress uploads and HuggingFace imports
- Conflict detection and overwrite confirmation
- Polling fallback when SSE connection drops
- `mountedRef` guard to prevent state updates on unmounted components

### Added — Phase 10: Settings Page

- Tabbed settings page: S3, HuggingFace, Proxy, Transfer, Pagination
- Settings persistence in a dedicated K8s Secret (`brewet-storage-backend-settings`) per project, synced on create/edit and on backend startup
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
- Storage-backend image targets in Makefile (`build-storage-backend`, `push-storage-backend`, `scan-storage-backend`)

### Added — Phase 12: Documentation & Polish

- Brewet wheelbarrow logo SVG (`img/brewet.svg`) and branded nav icon
- User guide (`docs/USER_GUIDE.md`) with feature walkthroughs and screenshot placeholders
- Development best practices guide (`docs/development/BEST_PRACTICES.md`) covering storage backend, BFF, frontend, Helm, security, and cross-component patterns
- Testing guide (`docs/development/TESTING.md`) with contract testing principles and integration test scenarios
- `[PLUGIN-SPECIFIC]` annotations in `plugin.yaml` for customizable fields
- Self-signed certificate and port override tips in local setup docs

### Changed

- Replaced "container" terminology with "Brewet" throughout the UI (toolbar, wizard, status labels)
- Redesigned header layout with persistent toolbar and reduced gap to page content
- HuggingFace import now prepends the current folder path to the S3 prefix
- Removed location name from breadcrumb and clipboard path (cleaner display)
- Expanded `CONTRIBUTING.md` with three-component dev setup instructions
- Added integration pattern summary table to `README.md`
- Added Brewet logo to `README.md`

### Fixed

- Project selector dropdown now closes when the browser window loses focus
- Logo SVG cropped and sized correctly (removed padding and explicit width/height)
- Backend in-memory settings now sync from the K8s Secret on every startup
- Data connection lookup corrected for container wizard
- Root-cause error messages surfaced for HuggingFace import failures
- BFF auth gate removed (was blocking unauthenticated health checks)
- PVC root listing fixed in storage backend
- Data-plane resilience hardened (retry, timeout, error propagation)
- Container wizard stays mounted across container status transitions
- AbortController cleanup in hooks (`useProjects`)
- URL-safe base64 encoding to prevent Fastify route param breakage
- `formatBytes` guard against fractional byte values
- Sync-chart-version regex preventing corruption of `k8sResources.ts`
- Node.js version updated to 22 in CI to match Containerfiles
- Security, resilience, accessibility, and cleanup hardening

[Unreleased]: https://github.com/rh-ai-community-plugins/brewet/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/rh-ai-community-plugins/brewet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rh-ai-community-plugins/brewet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rh-ai-community-plugins/brewet/releases/tag/v0.1.0
