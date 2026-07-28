# Customizing This Plugin

This document describes the artifacts a community plugin must produce and the plugin-specific identifiers used throughout the codebase.

---

## Plugin Deliverables

Every community plugin must produce the artifacts listed below. All naming derives from a single **plugin name** in kebab-case (e.g. `my-cool-plugin`).

### Naming Conventions

Given a plugin name `{plugin}`, the standard naming scheme is:

| Artifact | Name | Example |
|---|---|---|
| Frontend container image | `{plugin}` | `my-cool-plugin` |
| BFF container image | `{plugin}-bff` | `my-cool-plugin-bff` |
| Storage backend container image | `{plugin}-storage-backend` | `my-cool-plugin-storage-backend` |
| Helm chart | `{plugin}-chart` | `my-cool-plugin-chart` |
| npm package | `{plugin}` | `my-cool-plugin` |
| Module Federation remote | `{plugin}` in camelCase | `myCoolPlugin` |

All images and charts are published under the same OCI registry (e.g. `quay.io/rh-ai-community-plugins`).

### Required Artifacts

#### 1. Frontend Container Image

The plugin UI, bundled by Webpack and served by Nginx. This image exposes the `remoteEntry.js` file that the RHOAI dashboard loads at runtime via Module Federation.

- **Containerfile**: `Containerfile` at the repository root
- **Image name**: `{registry}/{plugin}` (e.g. `quay.io/rh-ai-community-plugins/my-cool-plugin`)
- Serves static assets on port **8080** as non-root user (UID 1001)
- Must add a CORS `Access-Control-Allow-Origin` header on `remoteEntry.js`
- Must comply with OpenShift's `restricted-v2` SCC (non-root, drop all capabilities, `RuntimeDefault` seccomp)

#### 2. Helm Chart (packaged as OCI artifact)

A Helm chart in the `chart/` directory that deploys the plugin's Kubernetes resources (Deployment + Service for the frontend, and optionally the BFF).

- **Chart name**: `{plugin}-chart` (the `-chart` suffix avoids OCI registry collisions with the container image of the same name)
- **OCI registry**: `oci://{registry}/{plugin}-chart` (e.g. `oci://quay.io/rh-ai-community-plugins/my-cool-plugin-chart`)
- The chart must use `nameOverride` in `values.yaml` so that deployed Kubernetes resources use the plugin name (without the `-chart` suffix)
- The chart version is kept in sync with the project version via `scripts/sync-chart-version.js`
- **Automatic deployment**: If you want the plugin to be automatically deployed by an external mechanism (such as the community-plugins admin plugin), the Helm chart **must** be packaged and published as an OCI artifact to the registry. The admin plugin pulls the chart from the OCI URL declared in `plugin.yaml` to install the plugin on the cluster. Without a published OCI chart, only manual `helm install chart/` from a local checkout is possible.

Package and push with:

```bash
make chart-push
```

Or manually:

```bash
helm package chart/
helm push {plugin}-chart-{version}.tgz oci://{registry}
```

#### 3. `plugin.yaml`

A manifest file at the repository root that serves as the single source of truth for the plugin's identity, compatibility, deployment model, and integration details. This file is consumed by:

- The **community plugin catalog/registry** (charter) to discover and list available plugins
- The **community-plugins admin plugin** to know how to install the plugin (Helm chart OCI URL, prerequisites, RBAC requirements)
- **Developers** as a reference for all plugin-specific identifiers

Key fields:

| Field | Purpose |
|---|---|
| `name` | Plugin identifier (kebab-case), must be unique across all community plugins |
| `displayName` | Human-readable name shown in the catalog |
| `description` | Short description of what the plugin does |
| `version` | Current version, kept in sync with `package.json` |
| `maintainer` | Name and GitHub handle of the maintainer |
| `rhoai_compatibility` | Minimum and tested RHOAI Dashboard versions |
| `deployment_model` | `per-project`, `cluster-shared`, or `both` |
| `image.repository` | Full path to the frontend container image |
| `image.tag` | Image tag, kept in sync with `version` |
| `install.method` | `automatic`, `assisted`, or `manual` |
| `install.helm.chart_path` | Local path to the chart directory |
| `install.helm.registry` | OCI URL of the published chart (required for automatic install) |
| `install.prerequisites` | List of cluster requirements (e.g. CRDs, operators) |
| `remote.spec` | Module Federation config: name, scope, `remoteEntry` URL, routes, and extensions |
| `rbac` | Required roles and whether cluster-wide roles are needed |

See [`plugin.yaml`](../../plugin.yaml) for a complete annotated example.

#### 4. `extensions.ts`

The Module Federation entry module at `src/rhoai/extensions.ts`. This is the file the dashboard host loads at runtime to discover the plugin's navigation items, routes, and feature areas. It must be exposed as `./extensions` in the webpack Module Federation config.

#### 5. CI Pipeline

A CI workflow (e.g. `.github/workflows/ci.yml`) that runs validation on push and pull requests:

- TypeScript type checking
- ESLint
- Unit tests

This ensures the plugin stays healthy as it evolves. This project includes a ready-to-use GitHub Actions workflow.

### Optional Artifacts

#### BFF Container Image

If the plugin needs its own backend service (e.g. for data aggregation, proxying to external APIs, or server-side logic), it should follow the [BFF pattern](../architecture/BFF_PATTERN.md).

- **Containerfile**: `bff/Containerfile`
- **Image name**: `{registry}/{plugin}-bff` (e.g. `quay.io/rh-ai-community-plugins/my-cool-plugin-bff`)
- Runs on port **3000** as non-root user (UID 1001)
- The dashboard proxies requests from `/{plugin}/api/*` to this service, forwarding the user's Bearer token
- The Helm chart should include the BFF as an optional component (`bff.enabled: true` by default)

#### Build and Push Workflow

A CI workflow (e.g. `.github/workflows/build-push.yml`) that builds and pushes container images to the registry. This project includes one triggered via `workflow_dispatch`.

### Summary Checklist

```text
my-cool-plugin/
├── plugin.yaml                          # Plugin metadata (required)
├── Containerfile                        # Frontend image build (required)
├── chart/                               # Helm chart (required)
│   ├── Chart.yaml                       #   name: my-cool-plugin-chart
│   ├── values.yaml                      #   nameOverride: my-cool-plugin
│   └── templates/
├── src/rhoai/extensions.ts              # Extension declarations (required)
├── bff/Containerfile                    # BFF image build (optional)
├── storage-backend/Containerfile        # Storage backend image build (optional)
├── .github/workflows/ci.yml             # CI validation (recommended)
├── .github/workflows/build-push.yml     # Image publish (recommended)
└── Makefile                             # Build, validate, image, chart targets
```

Published OCI artifacts:

```text
quay.io/rh-ai-community-plugins/my-cool-plugin:0.1.0                  # Frontend image
quay.io/rh-ai-community-plugins/my-cool-plugin-bff:0.1.0              # BFF image (optional)
quay.io/rh-ai-community-plugins/my-cool-plugin-storage-backend:0.1.0  # Storage backend image (optional)
oci://quay.io/rh-ai-community-plugins/my-cool-plugin-chart             # Helm chart (required for auto-deploy)
```

---

## Reference

The sections below list every plugin-specific identifier in the codebase and the files they appear in. These identifiers are annotated with `[PLUGIN-SPECIFIC]` and `[SHARED]` comments throughout the codebase.

- **`[PLUGIN-SPECIFIC]`** — Must be unique per plugin.
- **`[SHARED]`** — Common convention across all community plugins. Do not change.

### Naming Conventions

- **Route prefix, IDs, section IDs**: kebab-case (`my-plugin`)
- **Module Federation name/scope**: camelCase (`myPlugin`)
- **Nav item IDs**: prefix with your plugin name (`my-plugin-page-name`)
- **Section group sort key**: `{number}_{snake_case}` (e.g. `1_my_plugin`)
- **npm package name**: `{your-plugin}`

All route prefixes, hrefs, and path patterns in `extensions.ts` must use the same prefix as the route extension's `path` (e.g. `/my-plugin/*`).

### Identifiers to change

| File | Identifier | Current value | Replace with |
|---|---|---|---|
| `package.json` | `name` | `brewet` | `{your-plugin}` |
| `package.json` | `module-federation.name` | `brewet` | `{yourPlugin}` (camelCase) |
| `package.json` | `module-federation.proxy[].path` | `/brewet` | `/{your-plugin}` |
| `package.json` | `module-federation.proxy[].pathRewrite` | `/brewet` | `/{your-plugin}` |
| `package.json` | `module-federation.local.port` | `9500` | Any unused port (see [Port allocation](#port-allocation)) |
| `plugin.yaml` | `name` | `brewet` | `{your-plugin}` |
| `plugin.yaml` | `displayName` | `Brewet` | Your plugin name |
| `plugin.yaml` | `image.repository` | `quay.io/.../brewet` | Your image repository |
| `plugin.yaml` | `install.helm.registry` | `oci://quay.io/.../brewet` | Your OCI chart registry |
| `plugin.yaml` | `remote.spec.name` | `brewet` | `{yourPlugin}` (camelCase) |
| `plugin.yaml` | `remote.spec.scope` | `brewet` | `{yourPlugin}` (must match `name`) |
| `plugin.yaml` | `remote.spec.remoteEntry` | `.../brewet/...` | Your deployed image URL |
| `plugin.yaml` | `remote.spec.paths[0].path` | `/brewet` | `/{your-plugin}` |
| `plugin.yaml` | `remote.spec.paths[0].extensions` | `brewet/extensions` | `{yourPlugin}/extensions` |
| `plugin.yaml` | `remote.spec.paths[1].path` | `brewet/Icon` | `{yourPlugin}/Icon` |
| `src/rhoai/extensions.ts` | area `id` | `brewet` | `{your-plugin}` |
| `src/rhoai/extensions.ts` | plugin section `id` | `brewet` | `{your-plugin}` |
| `src/rhoai/extensions.ts` | plugin section `title` | `Brewet` | Your plugin name |
| `src/rhoai/extensions.ts` | plugin section `group` | `1_brewet` | `{N}_{your_plugin}` |
| `src/rhoai/extensions.ts` | nav item `id`s | `brewet-*` | `{your-plugin}-{page}` |
| `src/rhoai/extensions.ts` | nav item `href`/`path` | `/brewet/*` | `/{your-plugin}/*` |
| `src/rhoai/extensions.ts` | route `path` | `/brewet/*` | `/{your-plugin}/*` |
| `src/bootstrap.tsx` | `Router basename` | `/brewet` | `/{your-plugin}` |
| `config/webpack.common.js` | MF plugin `name` | `brewet` | `{yourPlugin}` (camelCase) |
| `config/moduleFederation.js` | `name` | `brewet` | `{yourPlugin}` (camelCase) |
| `config/webpack.dev.js` | proxy `context` | `/brewet` | `/{your-plugin}` |
| `config/webpack.dev.js` | `port` | `9500` | Same as `package.json` port |
| `.env.development` | `URL_PREFIX` | `/brewet` | `/{your-plugin}` |
| `chart/Chart.yaml` | `name` | `brewet-chart` | `{your-plugin}-chart` |
| `chart/values.yaml` | `image.repository` | `quay.io/.../brewet` | Your image repository |
| `chart/values.yaml` | `ingress.path` | `/brewet` | `/{your-plugin}` |

### Identifiers to keep (shared)

These are shared conventions that all community plugins should use identically:

| File | Identifier | Value | Purpose |
|---|---|---|---|
| `src/rhoai/extensions.ts` | community section `id` | `community-plugins` | Groups all community plugins in one sidebar section |
| `src/rhoai/extensions.ts` | community section `title` | `Community plugins` | Display name for the shared section |
| `src/rhoai/extensions.ts` | community section `group` | `9_plugins` | Sort position in the dashboard sidebar |
| `src/rhoai/extensions.ts` | plugin section `section` ref | `community-plugins` | Nests your plugin under the shared section |
| `config/webpack.common.js` | MF `filename` | `remoteEntry.js` | Standard Module Federation entry filename |
| `config/webpack.common.js` | expose keys | `./extensions`, `./Icon` | Standard module names expected by the host |

### Port Allocation

The dev server port only matters if you run multiple plugin dev servers simultaneously — each needs a unique port. Otherwise, any free port works. This project defaults to **9500**. The official RHOAI plugins in the dashboard monorepo occupy ports 9100–9111; community plugins use a different range to avoid any potential collision.
