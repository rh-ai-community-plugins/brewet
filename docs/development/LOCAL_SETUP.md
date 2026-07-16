# Local Development Environment Setup

This guide covers two ways to run the RHOAI Dashboard locally for plugin development:

1. **Container-based** (recommended) -- Run the dashboard from a pre-built container image. Fastest to set up; ideal for plugin development.
2. **Source-based** -- Clone and run the dashboard from source. Gives you full HMR and the ability to modify the dashboard itself.

---

## Prerequisites

Both methods require:

- **Node.js 20+** installed (check with `node --version`)
- **npm** (comes with Node.js)
- **`oc` CLI** installed and configured ([install guide](https://docs.openshift.com/container-platform/latest/cli_reference/openshift_cli/getting-started-cli.html))
- **Access to an OpenShift cluster** with Red Hat OpenShift AI (RHOAI) installed
- **cluster-admin access** on the cluster (required for the dashboard backend)

The container-based method additionally requires:

- **Podman** (or Docker) installed

---

## Optional: Local Storage Setup

Before starting the storage backend, set up the local storage targets you want to test. You can set up S3, local directories (PVC simulation), or both.

**S3 with MinIO:**

```bash
podman run --rm -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"
```

The MinIO console is at `http://localhost:9001` (login: `minioadmin` / `minioadmin`). Create a test bucket before starting the storage backend.

**Local directories for PVC simulation:**

PVCs in the cluster are just mounted directories. To simulate them locally, create any writable directories:

```bash
mkdir -p /tmp/brewet-vol1 /tmp/brewet-vol2
```

These paths are passed to the storage backend via the `LOCAL_STORAGE_PATHS` env var and appear as `local-0`, `local-1`, etc. in the storage browser.

---

## Method 1: Container-Based (Recommended)

Run the dashboard from a container image with `--network=host` so it can reach your plugin dev server on localhost. No need to clone the dashboard repo.

### Step 1: Log into your cluster

```bash
oc login https://api.your-cluster.com
oc project redhat-ods-applications
```

### Step 2: Run the dashboard container

```bash
cp ~/.kube/config /tmp/kubeconfig && chmod 644 /tmp/kubeconfig

podman run --rm --network=host \
  -v /tmp/kubeconfig:/tmp/kubeconfig:ro \
  -e KUBECONFIG=/tmp/kubeconfig \
  -e APP_ENV=development \
  -e OC_PROJECT=redhat-ods-applications \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
  -e MODULE_FEDERATION_CONFIG='[{
    "name": "brewet",
    "backend": {
      "remoteEntry": "/remoteEntry.js",
      "tls": false,
      "localService": { "host": "localhost", "port": 9500 },
      "service": { "name": "placeholder", "namespace": "opendatahub", "port": 8080 }
    },
    "proxyService": [{
      "path": "/brewet/api",
      "pathRewrite": "/api",
      "authorize": true,
      "tls": false,
      "localService": { "host": "localhost", "port": 3000 },
      "service": { "name": "placeholder", "namespace": "opendatahub", "port": 3000 }
    }]
  }]' \
  quay.io/opendatahub/odh-dashboard:main \
  bash -c "npm install pino-pretty && npm run start"
```

### Step 3: Start the storage backend

The storage backend handles S3 and local filesystem (PVC) operations. In production it runs per-project inside the cluster; for local dev you run a single instance on your machine. See [Local Storage Setup](#optional-local-storage-setup) above for MinIO and PVC directory setup.

In a **separate terminal**, from the plugin project root:

```bash
cd storage-backend
npm install   # first time only

AWS_ACCESS_KEY_ID=minioadmin \
AWS_SECRET_ACCESS_KEY=minioadmin \
AWS_S3_ENDPOINT=http://localhost:9000 \
AWS_DEFAULT_REGION=us-east-1 \
LOCAL_STORAGE_PATHS=/tmp/brewet-vol1,/tmp/brewet-vol2 \
APP_ENV=development \
npm run start:dev
```

You should see the server start on port 8888. If you only need S3 testing, omit `LOCAL_STORAGE_PATHS` (defaults to a single ephemeral directory at `/opt/app-root/src/data`). If you only need local storage testing, omit the `AWS_*` variables.

### Step 4: Start the BFF service

The BFF proxies data-plane requests from the dashboard to the storage backend. It needs `STORAGE_BACKEND_URL` to find the local storage backend (bypassing K8s service discovery) and `K8S_API_BASE` for cluster API calls.

In a **separate terminal**, from the plugin project root:

```bash
cd bff
npm install   # first time only
STORAGE_BACKEND_URL=http://localhost:8888 \
K8S_API_BASE=$(oc whoami --show-server) \
npm run start:dev
```

You should see `BFF listening on port 3000`. Without `STORAGE_BACKEND_URL`, the BFF tries K8s service discovery (which won't work locally). Without `K8S_API_BASE`, cluster API calls will fail with 502 errors.

> **Note:** The `proxyService` entry in the `MODULE_FEDERATION_CONFIG` (Step 2) is what tells the dashboard to forward `/brewet/api/*` requests to the BFF at `localhost:3000`. If you omit the `proxyService` block, those requests will hit the dashboard's SPA fallback and return HTML instead of JSON.

### Step 5: Start the plugin dev server

In another terminal, from the plugin project root:

```bash
npm run start:dev
```

### Step 6: Verify

You should now have **four processes** running (plus optionally MinIO):

| Process | Port | Purpose |
|---|---|---|
| Dashboard container | 8080 | Host application, proxies to plugin and BFF |
| Storage backend | 8888 | Data-plane server for S3 and local filesystem operations |
| BFF service | 3000 | Proxy routing data-plane requests to the storage backend |
| Plugin dev server | 9500 | Plugin frontend (webpack dev server with HMR) |
| MinIO (optional) | 9000 / 9001 | Local S3-compatible object storage |

Open the dashboard URL in your browser. You should see the RHOAI Dashboard with the Brewet plugin loaded in the sidebar.

### How it works

- The backend reads `MODULE_FEDERATION_CONFIG`, registers a proxy `/_mf/brewet/*` that routes to `http://localhost:9500/*`.
- The backend injects the plugin metadata into the HTML via `<script id="mf-remotes-json">`.
- The frontend discovers and loads your plugin at runtime via `@module-federation/runtime`.
- `--network=host` means the container's `localhost` is your host's `localhost`, so the proxy reaches your plugin dev server.

### What works and what doesn't

| Feature | Works? | Why |
|---|---|---|
| Plugin loads in dashboard | Yes | Runtime MF discovery + backend proxy |
| Plugin auto-rebuild on save | Yes | Your plugin's webpack dev server handles this |
| Plugin changes visible automatically | Yes | Webpack dev server rebuilds on save and the browser picks up changes |
| Dashboard auto-reload | No | Container serves pre-built static assets |
| Cluster API access | Yes | Via mounted kubeconfig |
| Plugin menu items / nav | Yes | Extensions are loaded at runtime |

### Things to watch for

1. **`--network=host` is required** -- Without it, `localhost` inside the container doesn't reach your host. On macOS/Windows with Podman machine, you may need `host.containers.internal` instead and adjust the `localService.host` value in the config accordingly.
2. **Shared dependency versions** -- Your plugin's `react`, `react-dom`, `@patternfly/react-core`, etc. must match the versions in the dashboard image. Version mismatches cause runtime errors. Check the dashboard's `package.json` for the version you're targeting.
3. **`APP_ENV=development`** -- Enables dev mode in the backend, which makes the MF proxy route to `localService.host:localService.port` instead of the in-cluster service address.
4. **Kubeconfig mount path** -- The path depends on the container's `HOME`. The UBI9 Node.js image uses `/opt/app-root/src`. Verify with `podman run --rm -it <image> bash -c 'echo $HOME'`.
5. **Port-forwarding** -- If your plugin has a BFF that talks to in-cluster services, you'll still need `oc port-forward` for those, just like in normal dev mode.

---

## Method 2: Source-Based (Advanced)

Clone and run the dashboard from source. This gives you full hot module replacement (HMR) for both the dashboard and your plugin, and the ability to modify dashboard code. Recommended when you need to debug dashboard internals or develop dashboard features alongside your plugin.

### Step 1: Clone the dashboard repository

```bash
git clone https://github.com/opendatahub-io/odh-dashboard.git
cd odh-dashboard
```

### Step 2: Switch to the desired version/tag

Check the [releases page](https://github.com/opendatahub-io/odh-dashboard/tags) for available versions. Currently recommended:

```bash
git checkout v3.4.4
```

### Step 3: Create your local environment file

```bash
cp env.local.example env.local
```

### Step 4: Install dependencies

```bash
npm install
```

### Step 5: Log into the cluster

You need cluster-admin access for the backend to function in dev mode:

```bash
oc login --server=https://<your-cluster-api-url>:6443
```

Verify access:

```bash
oc whoami
oc auth can-i create pods --all-namespaces   # Should return "yes" for cluster-admin
```

### Step 6: Configure the plugin

Edit `env.local` in the odh-dashboard root and add (or update) the `MODULE_FEDERATION_CONFIG` variable with your plugin's entry:

```bash
MODULE_FEDERATION_CONFIG=[{"name":"brewet","backend":{"remoteEntry":"/remoteEntry.js","tls":false,"localService":{"host":"localhost","port":9500},"service":{"name":"placeholder","namespace":"opendatahub","port":8080}},"proxyService":[{"path":"/brewet/api","pathRewrite":"/api","authorize":true,"tls":false,"localService":{"host":"localhost","port":3000},"service":{"name":"placeholder","namespace":"opendatahub","port":3000}}]}]
```

Or in readable JSON form, the entry looks like:

```json
{
  "name": "brewet",
  "backend": {
    "remoteEntry": "/remoteEntry.js",
    "tls": false,
    "localService": { "host": "localhost", "port": 9500 },
    "service": { "name": "placeholder", "namespace": "opendatahub", "port": 8080 }
  },
  "proxyService": [{
    "path": "/brewet/api",
    "pathRewrite": "/api",
    "authorize": true,
    "tls": false,
    "localService": { "host": "localhost", "port": 3000 },
    "service": { "name": "placeholder", "namespace": "opendatahub", "port": 3000 }
  }]
}
```

### Step 7: Start the dashboard (two terminals)

**Terminal 1 -- Backend:**

```bash
cd backend
npm run start:dev
```

**Terminal 2 -- Frontend:**

```bash
cd frontend
npm run start:dev
```

### Step 8: Start the storage backend

The storage backend handles S3 and local filesystem (PVC) operations. See [Local Storage Setup](#optional-local-storage-setup) above for MinIO and PVC directory setup.

In a **separate terminal**, from the plugin project root:

```bash
cd storage-backend
npm install   # first time only

AWS_ACCESS_KEY_ID=minioadmin \
AWS_SECRET_ACCESS_KEY=minioadmin \
AWS_S3_ENDPOINT=http://localhost:9000 \
AWS_DEFAULT_REGION=us-east-1 \
LOCAL_STORAGE_PATHS=/tmp/brewet-vol1,/tmp/brewet-vol2 \
APP_ENV=development \
npm run start:dev
```

You should see the server start on port 8888. Omit `LOCAL_STORAGE_PATHS` for S3-only testing, or omit the `AWS_*` variables for local-storage-only testing.

### Step 9: Start the BFF service

The BFF proxies data-plane requests to the storage backend. In a **separate terminal**, from the plugin project root:

```bash
cd bff
npm install   # first time only
STORAGE_BACKEND_URL=http://localhost:8888 \
K8S_API_BASE=$(oc whoami --show-server) \
npm run start:dev
```

You should see `BFF listening on port 3000`. `STORAGE_BACKEND_URL` bypasses K8s service discovery for local dev. `K8S_API_BASE` is required for cluster API calls.

> **Note:** The `proxyService` entry in `env.local` (Step 6) tells the dashboard to forward `/brewet/api/*` requests to the BFF. Without it, those requests return HTML instead of JSON.

### Step 10: Start the plugin dev server

From the plugin project root:

```bash
npm run start:dev
```

### Step 11: Verify

You should now have **five processes** running (plus optionally MinIO): dashboard backend (terminal 1), dashboard frontend (terminal 2), storage backend (port 8888), BFF (port 3000), and plugin dev server (port 9500).

Open <http://localhost:4010> in your browser. You should see the RHOAI Dashboard with the Brewet plugin loaded in the sidebar.

---

## Config Field Reference

Both methods use the same `MODULE_FEDERATION_CONFIG` format:

| Field | Description |
|---|---|
| `name` | The Module Federation remote name. Must match the `name` in the plugin's webpack `ModuleFederationPlugin` config. |
| `backend.remoteEntry` | Path to the `remoteEntry.js` file served by the plugin's dev server. |
| `backend.tls` | Whether the plugin dev server uses HTTPS. Set to `false` for local development. |
| `backend.localService.host` | Hostname of the plugin dev server. Use `localhost` for local development. |
| `backend.localService.port` | Port the plugin dev server listens on. Must match the plugin's webpack dev server port. |
| `backend.service.name` | Kubernetes Service name used in production. Set to `placeholder` for local dev (the `localService` overrides it). |
| `backend.service.namespace` | Kubernetes namespace. Set to `opendatahub` (or `redhat-ods-applications` for RHOAI). |
| `backend.service.port` | Service port in production. Not used when `localService` is set. |

### BFF Proxy Fields (`proxyService[]`)

If your plugin has its own backend service (BFF pattern), add a `proxyService` array alongside `backend`:

| Field | Description |
|---|---|
| `proxyService[].path` | URL path prefix the dashboard intercepts (e.g. `/brewet/api`). |
| `proxyService[].pathRewrite` | Replacement prefix forwarded to the BFF (e.g. `/api`). |
| `proxyService[].authorize` | When `true`, the dashboard forwards the user's Bearer token as `Authorization` header. |
| `proxyService[].tls` | Whether the BFF uses HTTPS. Set to `false` for local development. |
| `proxyService[].localService.host` | BFF hostname for local dev (typically `localhost`). |
| `proxyService[].localService.port` | BFF port for local dev (e.g. `3000`). |
| `proxyService[].service.name` | Kubernetes Service name for the BFF in production. |
| `proxyService[].service.namespace` | Kubernetes namespace. |
| `proxyService[].service.port` | BFF Service port in production. |

When `localService` is present, the dashboard backend proxies to that host/port instead of looking up the Kubernetes Service. This is what makes local plugin development work.

---

## Plugin Development Workflow

Regardless of which method you chose above, the plugin development workflow is the same:

1. Start the dashboard (container or source) -- ensure `MODULE_FEDERATION_CONFIG` includes the `proxyService` entry
2. Start MinIO or create local directories for PVC simulation (see [Local Storage Setup](#optional-local-storage-setup))
3. Start the storage backend with S3 and/or local storage env vars (see the storage backend step in your chosen method above)
4. Start the BFF service with `cd bff && STORAGE_BACKEND_URL=http://localhost:8888 K8S_API_BASE=$(oc whoami --show-server) npm run start:dev`
5. Start the plugin dev server with `npm run start:dev`
6. Open the dashboard URL in your browser
7. Navigate to the plugin's page in the dashboard sidebar
8. Edit plugin source files -- changes are picked up automatically with both methods

The dev server supports a custom port via the `PORT` environment variable:

```bash
PORT=9200 npm run start:dev
```

### Port conventions

This project defaults to port **9500**. The port only matters if you run multiple plugin dev servers at the same time — each needs a unique port. Otherwise, any free port works. You can override it with the `PORT` environment variable.

> **Note:** The official RHOAI plugins in the dashboard monorepo occupy ports 9100–9111. Community plugins use a different range to avoid any potential collision.

---

## Troubleshooting

### Plugin does not appear in the dashboard sidebar

- Verify the plugin dev server is running and accessible at `http://localhost:9500/remoteEntry.js`
- Check the `MODULE_FEDERATION_CONFIG` -- the `name` must match the plugin's webpack config
- Ensure the `localService.port` matches the port your plugin dev server is running on
- **Method 1**: Restart the container after changing `MODULE_FEDERATION_CONFIG`
- **Method 2**: Restart the dashboard backend after changing `env.local`

### "Shared module not found" or React version errors

- Your plugin's shared dependency versions must be compatible with the dashboard's versions. Check the dashboard's `frontend/package.json` for the exact versions of React, PatternFly, and react-router-dom.

### Backend fails to start

- Ensure you are logged into the cluster with `oc login` and have cluster-admin access
- Check that the OpenShift API server is reachable from your machine
- Try `oc whoami --show-server` to verify connectivity

### Hot reload not working

- Check the browser console for errors
- Ensure the plugin dev server is running (not just built)
- Try a hard refresh (Ctrl+Shift+R) if the module cache is stale

### BFF: "Failed to load namespace summary" with HTML parse error

The frontend receives HTML instead of JSON. This means the request to `/brewet/api/*` is not being proxied to the BFF and is hitting the SPA fallback instead.

- Ensure your `MODULE_FEDERATION_CONFIG` includes the `proxyService` block (see the config examples above)
- Restart the dashboard after changing `MODULE_FEDERATION_CONFIG`

### BFF: "Failed to fetch namespace summary: 502"

The dashboard is correctly proxying to the BFF, but the BFF is returning an error.

- **BFF not running**: Ensure the BFF is running (`cd bff && STORAGE_BACKEND_URL=http://localhost:8888 K8S_API_BASE=$(oc whoami --show-server) npm run start:dev`). You should see `BFF listening on port 3000`.
- **Missing `K8S_API_BASE`**: The BFF needs to know the cluster API URL. Without `K8S_API_BASE`, it cannot make Kubernetes API calls. Set it with `K8S_API_BASE=$(oc whoami --show-server)`.
- **Cluster unreachable**: Verify you can reach the cluster API from your machine with `oc whoami`. If your login session has expired, run `oc login` again.
- Check the BFF terminal for error messages -- they will indicate whether the issue is with the K8s API connection, token, or RBAC permissions.

### BFF: ECONNREFUSED on port 3000

The dashboard log shows `connect ECONNREFUSED ... :3000`. The dashboard is trying to proxy to the BFF but nothing is listening on port 3000.

- Start the BFF: `cd bff && STORAGE_BACKEND_URL=http://localhost:8888 K8S_API_BASE=$(oc whoami --show-server) npm run start:dev`
- If using a container without `--network=host`, `localhost` inside the container won't reach the host. Use `--network=host` or set `localService.host` to `host.containers.internal` in the `proxyService` config.

### BFF: 502 or ECONNREFUSED on port 8888

The BFF log shows connection errors to port 8888. The BFF is trying to reach the storage backend but nothing is listening.

- Start the storage backend: `cd storage-backend && APP_ENV=development npm run start:dev`
- Ensure `STORAGE_BACKEND_URL=http://localhost:8888` is set when starting the BFF. Without it, the BFF tries K8s service discovery, which won't work outside the cluster.

### Storage backend: S3 connection errors

- Verify MinIO (or your S3-compatible server) is running and accessible at the `AWS_S3_ENDPOINT` URL
- Check that `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` match the MinIO credentials
- Ensure the bucket exists — create it via the MinIO console at `http://localhost:9001`
- If `AWS_S3_ENDPOINT` is empty, S3 operations will fail but local storage operations will still work

### Storage backend: Local storage path errors

- Verify the directories in `LOCAL_STORAGE_PATHS` exist and are writable
- Paths must be absolute (e.g. `/tmp/brewet-vol1`, not `./brewet-vol1`)
- Check the storage backend terminal for warnings about missing or inaccessible paths
