# Development

Guides for setting up a local development environment and working with the dashboard backend APIs.

## Documents

- [PROJECT_LAYOUT.md](PROJECT_LAYOUT.md) -- Start here. Maps the directory structure, explains what each piece does, and identifies shared vs plugin-specific files.
- [DASHBOARD_APIS.md](DASHBOARD_APIS.md) -- Covers the three integration patterns (Dashboard API, K8s pass-through, BFF), with a decision guide for choosing the right one. Also includes the full API reference, authentication flow, and code examples.
- [LOCAL_SETUP.md](LOCAL_SETUP.md) -- Complete guide to setting up the RHOAI Dashboard and plugin dev server locally, including prerequisites, dashboard configuration, BFF setup, and hot reload workflow.
- [CUSTOMIZATION.md](CUSTOMIZATION.md) -- Lists the required and optional deliverables (container images, Helm chart, plugin.yaml), their naming conventions, and the plugin-specific identifiers used throughout the codebase.
- [BUILD_AND_PUSH.md](BUILD_AND_PUSH.md) -- Building and pushing container images (frontend, BFF, and storage backend) to Quay.io, scanning for vulnerabilities with Trivy, and the CI build workflow. Also covers the Makefile that wraps all common build tasks.
- [BEST_PRACTICES.md](BEST_PRACTICES.md) -- Common pitfalls and development patterns across the storage backend, BFF, frontend, and Helm chart. Includes security guidelines, cross-component contract testing, and a pre-PR checklist.
- [TESTING.md](TESTING.md) -- How to run tests, contract testing principles across the three-layer architecture, and integration test scenarios for manual verification.
