# BFF (Backend For Frontend) Pattern

This document explains the BFF pattern as implemented in this plugin.

---

## What is the BFF Pattern?

The BFF (Backend For Frontend) pattern gives a plugin its own backend service. Instead of the frontend making direct K8s API calls through the dashboard's `/api/k8s/*` pass-through, it calls the plugin's own backend, which performs server-side logic and returns processed results.

### When to Use a BFF

- **Data-plane proxying** -- Route requests to per-project backend services with service discovery, streaming support, and structured error handling (as the Brewet BFF does for storage backends)
- **External service integration** -- Call third-party APIs using credentials stored server-side (API keys never reach the browser)
- **Complex business logic** -- Processing that would be too expensive or impractical in the browser
- **Data transformation** -- Heavy filtering, sorting, or enrichment before sending data to the frontend

### When NOT to Use a BFF

- Simple CRUD on K8s resources -- use the dashboard's `/api/k8s/*` pass-through instead
- Reading dashboard config or user info -- use `/api/status`, `/api/config`, etc.
- Anything the dashboard backend already provides (see `DASHBOARD_APIS.md`)

---

## How It Works

### Token Flow

```text
Browser                    Dashboard Backend              Plugin BFF           Storage Backend
  |                              |                            |                     |
  |-- fetch('/brewet/api/my-ns/buckets/list') ---------->|                     |
  |                              |                            |                     |
  |                    [matches proxyService path]             |                     |
  |                    [authorize: true]                       |                     |
  |                              |                            |                     |
  |                              |-- GET /api/my-ns/buckets/list                    |
  |                              |   Authorization: Bearer <user-token>             |
  |                              |--------------------------->|                     |
  |                              |                            |                     |
  |                              |               [resolve storage backend URL]      |
  |                              |               [via K8s service discovery]        |
  |                              |                            |                     |
  |                              |                            |-- GET /api/buckets/list
  |                              |                            |------------------->|
  |                              |                            |<-- bucket list -----|
  |                              |                            |                     |
  |                              |<-- aggregated response ----|                     |
  |<-- JSON response ------------|                            |                     |
```

Key points:

1. The frontend calls a path like `/brewet/api/{namespace}/buckets/list` at the same origin
2. The dashboard backend matches this against `proxyService` entries in the federation ConfigMap
3. When `authorize: true`, the dashboard converts the user's `x-forwarded-access-token` into an `Authorization: Bearer <token>` header
4. The BFF extracts the namespace from the path and resolves the per-project storage backend URL via K8s service discovery
5. The request is proxied to the storage backend with the path rewritten from `/api/{namespace}/{path}` to `/api/{path}`

### Dashboard Proxy Configuration

The dashboard discovers BFF services via the `proxyService` field in the federation ConfigMap:

```json
{
  "name": "brewet",
  "backend": {
    "remoteEntry": "/remoteEntry.js",
    "service": { "name": "brewet", "namespace": "cp-brewet", "port": 8080 }
  },
  "proxyService": [{
    "path": "/brewet/api",
    "pathRewrite": "/api",
    "authorize": true,
    "tls": false,
    "service": { "name": "brewet-bff", "namespace": "cp-brewet", "port": 3000 }
  }]
}
```

| Field | Purpose |
|---|---|
| `path` | URL prefix the dashboard intercepts |
| `pathRewrite` | Replacement prefix forwarded to the BFF |
| `authorize` | Forward the user's Bearer token |
| `service` | K8s Service name, namespace, and port for the BFF |

---

## This Plugin's BFF Implementation

### Directory Structure

```text
bff/
  package.json              # Express + TypeScript project
  tsconfig.json
  Containerfile             # UBI9 Node 22, runs on port 3000
  src/
    server.ts               # Express app with health, CORS, logging, and storage proxy
    shutdown.ts             # Graceful SIGTERM shutdown handler
    routes/
      storageProxy.ts       # Proxy: /api/:namespace/* → storage backend
    middleware/
      rateLimiter.ts        # Per-client-IP rate limiting
    utils/
      k8sClient.ts          # K8s API caller with typed K8sHttpError
      serviceDiscovery.ts   # Resolve namespace → storage backend URL with TTL cache
      constants.ts          # Shared constants (K8S_NAMESPACE_RE)
  __tests__/
    storageProxy.test.ts
    serviceDiscovery.test.ts
    rateLimiter.test.ts
    shutdown.test.ts
    k8sClient.test.ts
```

### Storage Proxy: `/api/:namespace/*`

The BFF's primary role is proxying data-plane requests from the frontend to per-project storage backends:

1. Validates the namespace against K8s naming rules
2. Checks the path for traversal attacks (decodes URL-encoded segments, rejects `..`)
3. Resolves the storage backend URL via K8s service discovery (with in-flight deduplication and TTL cache)
4. Proxies the request with `http-proxy`, rewriting the path to `/api/{remainingPath}`
5. Supports streaming responses (SSE for transfers/imports, binary for downloads), multipart uploads
6. Sanitizes proxy headers (strips and rewrites `x-forwarded-*`)
7. Returns structured errors for missing/unreachable backends (404, 503) and access denied (403)

For local development, setting `STORAGE_BACKEND_URL` bypasses service discovery and proxies all namespaces to a single local instance.

### K8s Client

The `k8sClient.ts` utility makes authenticated requests to the K8s API server:

- **In-cluster**: Uses `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` env vars, reads the CA cert from the service account mount
- **Local dev**: Uses the `K8S_API_BASE` env var to point at the cluster API
- Throws typed `K8sHttpError` for structured error classification (404, 403, etc.)

The BFF uses its ServiceAccount token for service discovery and the user's forwarded Bearer token for proxied requests.

---

## Deployment

The BFF runs as a separate Deployment and Service in the Helm chart:

- **Deployment**: `brewet-bff` -- Node.js container on port 3000
- **Service**: `brewet-bff` -- ClusterIP service exposing port 3000

Both are gated by `.Values.bff.enabled` (default: `true`).

The BFF Service name in `values.yaml` must match the `proxyService.service.name` in the dashboard's federation ConfigMap.

---

## Local Development

The BFF runs as a separate Node.js process alongside the plugin dev server and the dashboard. See [LOCAL_SETUP.md](../development/LOCAL_SETUP.md) for full step-by-step instructions.

### Four-process setup

| Process | Port | What it does |
|---|---|---|
| Dashboard (container or source) | 8080 | Host app; proxies frontend and BFF requests |
| Storage backend | 8888 | Data-plane server for S3 and local filesystem operations |
| BFF service | 3000 | Proxy routing data-plane requests to the storage backend |
| Plugin dev server | 9500 | Plugin frontend; serves webpack bundles with HMR |

### Starting the BFF

```bash
cd bff
npm install                                              # first time only
STORAGE_BACKEND_URL=http://localhost:8888 \
K8S_API_BASE=$(oc whoami --show-server) npm run start:dev
```

**`STORAGE_BACKEND_URL` is required for local dev.** It bypasses K8s service discovery and proxies all namespaces to the local storage backend instance. Without it, the BFF tries K8s service discovery, which won't work outside the cluster.

**`K8S_API_BASE` is required.** When the BFF runs locally (not in-cluster), it doesn't have access to the `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` env vars that Kubernetes provides to pods. `K8S_API_BASE` tells the BFF where to find the cluster API server.

> **Tip:** If your cluster uses a self-signed certificate (common in dev/lab environments), add `K8S_TLS_SKIP_VERIFY=true` to skip TLS verification for K8s API calls:
>
> ```bash
> K8S_TLS_SKIP_VERIFY=true K8S_API_BASE=$(oc whoami --show-server) npm run start:dev
> ```
>
> This is not needed in production — the in-cluster CA bundle mounted from the `kube-root-ca.crt` ConfigMap handles TLS automatically.

### Dashboard proxy configuration

The dashboard must include a `proxyService` entry in `MODULE_FEDERATION_CONFIG` to route `/brewet/api/*` requests to the BFF:

```json
"proxyService": [{
  "path": "/brewet/api",
  "pathRewrite": "/api",
  "authorize": true,
  "tls": false,
  "localService": { "host": "localhost", "port": 3000 },
  "service": { "name": "placeholder", "namespace": "opendatahub", "port": 3000 }
}]
```

Without this entry, the dashboard won't proxy BFF requests and the frontend will receive HTML (the SPA fallback) instead of JSON.

### Standalone frontend development

The webpack dev server (`config/webpack.dev.js`) also has a proxy entry for `/brewet/api` that forwards to `localhost:3000`. This allows developing the frontend against the BFF without the full dashboard, but note that no user token will be forwarded in this mode.
