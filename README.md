<!-- markdownlint-disable-next-line MD033 MD041 -->
<div align="center"> <!-- markdownlint-disable-next-line MD033 -->
  <img src="img/brewet.svg" alt="Brewet" width="128" />
</div>

# Brewet

A community plugin for the **Red Hat OpenShift AI (RHOAI) Dashboard** that brings S3 and PVC storage management directly into the dashboard. Users can deploy a per-project storage backend, browse and manage files across S3 buckets and PVC-mounted volumes, transfer data between storage locations, import models from HuggingFace, and configure storage settings — all without leaving the RHOAI dashboard.

Brewet reimplements the storage features of [ODH-TEC](https://github.com/rh-aiservices-bu/odh-tec) (Open Data Hub Tools & Extensions Companion) as an RHOAI dashboard plugin, adding per-project container lifecycle management on top.

## Features

- **Storage Browser** — Unified file browser for S3 buckets and PVC-mounted directories. Upload, download, delete, create folders, preview files, search, paginate, and bulk-select.
- **Storage Management** — View all storage locations (S3 + PVC), create and delete S3 buckets.
- **Cross-Storage Transfers** — Move or copy files between S3 and PVC locations with real-time SSE progress, conflict detection, and cancellation.
- **HuggingFace Import** — Import models from HuggingFace Hub directly into S3 storage with streaming progress.
- **Settings** — Configure S3 connection, HuggingFace token, HTTP proxy, transfer concurrency, and pagination. Runtime overrides (ephemeral per container restart).
- **Per-Project Container Lifecycle** — Deploy, start, stop, edit, and delete the storage backend in any project. Select a Data Connection (S3 credentials) and PVCs to mount during creation.
- **Project Selector** — Persistent project selector across all pages. Switch projects without losing navigation context.

For detailed usage instructions, see the **[User Guide](docs/user/USER_GUIDE.md)**.

## Architecture

Brewet is a three-container system:

| Component | Scope | Port | Role |
|---|---|---|---|
| **Plugin Frontend** | Cluster-level (Helm) | 8080 | Nginx serving Module Federation `remoteEntry.js`. The RHOAI dashboard loads this at runtime. |
| **BFF** | Cluster-level (Helm) | 3000 | Express proxy that routes data-plane requests (file ops, transfers, settings) to per-project storage backends. Supports streaming, SSE, multipart uploads. |
| **Storage Backend** | Per-project (user-created) | 8888 | Fastify API server with S3 (via AWS SDK v3) and PVC (via Node.js `fs`) operations. Deployed by the plugin UI as a Deployment + Service. |

**Management plane** (creating/starting/stopping containers, listing Data Connections and PVCs) goes through the dashboard's existing `/api/k8s` proxy. **Data plane** (file browsing, uploads, downloads, transfers) goes through the BFF, which streams to the per-project storage backend. A NetworkPolicy restricts storage backend ingress to the BFF namespace.

```text
Browser ──► RHOAI Dashboard ──► /api/k8s ──► K8s API         (management plane)
Browser ──► RHOAI Dashboard ──► /brewet/api ──► BFF ──► Storage Backend   (data plane)
```

### Integration Patterns

Each page uses a different integration pattern with the RHOAI Dashboard:

| Page | Pattern | Data Flow |
|---|---|---|
| Storage Browser | Data plane (BFF) | Frontend → BFF → Storage Backend (streaming SSE, binary) |
| Storage Management | Hybrid | Create/delete buckets via BFF; list Data Connections via K8s API |
| Settings | Data plane (BFF) | Frontend → BFF → Storage Backend (JSON) |
| Container Lifecycle | Management plane (K8s) | Frontend → Dashboard `/api/k8s` proxy → K8s API |

For the full architecture and project plan, see [docs/project/PROJECT_PLAN.md](docs/project/PROJECT_PLAN.md).

## Quick Start

### Deploy on an Existing Dashboard

**Prerequisites:** Helm, `oc` CLI access to the cluster, and access to the `redhat-ods-applications` namespace (typically requires cluster-admin).

#### 1. Install the plugin

Install directly from the OCI registry:

```bash
helm install brewet oci://quay.io/rh-ai-community-plugins/brewet-chart \
  --version 0.1.0 \
  --namespace cp-brewet \
  --create-namespace
```

Or from a local checkout:

```bash
helm install brewet chart/ \
  --namespace cp-brewet \
  --create-namespace
```

This creates a Deployment and Service for the frontend (`brewet`, serving `remoteEntry.js` via Nginx), the BFF (`brewet-bff`, streaming proxy on port 3000), and the storage backend image reference (used when creating per-project containers).

#### 2. Register with the RHOAI Dashboard

Retrieve the current Module Federation configuration from the dashboard, append the plugin entry, and apply it:

```bash
oc get configmap federation-config \
  -n redhat-ods-applications \
  -o jsonpath='{.data.module-federation-config\.json}' \
| python3 -c "
import json, sys
config = json.load(sys.stdin)
config.append({
  'name': 'brewet',
  'backend': {
    'remoteEntry': '/remoteEntry.js',
    'authorize': False,
    'tls': False,
    'service': {
      'name': 'brewet',
      'namespace': 'cp-brewet',
      'port': 8080
    }
  },
  'proxyService': [{
    'path': '/brewet/api',
    'pathRewrite': '/api',
    'authorize': True,
    'tls': False,
    'service': {
      'name': 'brewet-bff',
      'namespace': 'cp-brewet',
      'port': 3000
    }
  }]
})
print(json.dumps(config))
" > /tmp/mf-config-extended.json

oc set env deployment/rhods-dashboard \
  -n redhat-ods-applications \
  "MODULE_FEDERATION_CONFIG=$(cat /tmp/mf-config-extended.json)"
```

New dashboard pods roll out automatically. After roughly two minutes, reload the RHOAI dashboard to see the plugin's sidebar entries.

#### 3. Verify

Confirm the plugin is registered in the dashboard configuration:

```bash
oc set env deployment/rhods-dashboard -n redhat-ods-applications --list \
  | grep MODULE_FEDERATION_CONFIG \
  | python3 -c "import json,sys; d=json.loads(sys.stdin.read().split('=',1)[1]); print([e['name'] for e in d])"
```

For Helm chart customization and BFF registration details, see [Deploying on OpenShift](docs/deployment/OPENSHIFT_DEPLOY.md).

### Local Development

Developing a dashboard plugin requires a **running RHOAI dashboard** connected to a **real OpenShift cluster**. There are two approaches:

- **Container-based** (recommended) — Run the dashboard as a container image alongside your plugin dev server.
- **Source-based** — Clone and run the [odh-dashboard](https://github.com/opendatahub-io/odh-dashboard) from source.

Both methods require Node.js 20+, `oc` CLI access to the cluster, and cluster-admin privileges. Once the environment is running:

```bash
npm install              # Install plugin dependencies
npm run start:dev        # Start the plugin dev server on port 9500
```

To work with the BFF:

```bash
cd bff
npm install
K8S_API_BASE=$(oc whoami --show-server) npm run start:dev
```

To work with the storage backend:

```bash
cd storage-backend
npm install
npm run start:dev        # Fastify dev server on port 8888
```

See the full [Local Setup Guide](docs/development/LOCAL_SETUP.md) for step-by-step instructions.

### Build & Test

```bash
npm run build           # Production build to dist/
npm test                # Run all tests
npm run lint            # ESLint + markdownlint
make help               # All available Makefile targets
```

## Documentation

- **[Project Plan](docs/project/PROJECT_PLAN.md)** — Detailed implementation plan with phases, architecture decisions, and open questions
- **[Architecture](docs/architecture/)** — Plugin system internals and extension contract
- **[Development](docs/development/)** — Local environment setup and backend API reference
- **[Deployment](docs/deployment/)** — Deploying on OpenShift with Helm and dashboard registration

## License

Apache-2.0
