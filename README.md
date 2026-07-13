# Brewet

A community plugin for the **Red Hat OpenShift AI (RHOAI) Dashboard**.

<!-- TODO: Describe what Brewet does and why it exists. -->

## Quick Start

### Deploy on an Existing Dashboard

**Prerequisites:** Helm, `oc` CLI access to the cluster, and access to the `redhat-ods-applications` namespace (typically requires cluster-admin).

#### 1. Install the plugin

Install directly from the OCI registry:

```bash
helm install rhoai-brewet oci://quay.io/OWNER/rhoai-brewet-chart \
  --version 0.4.0 \
  --namespace rhoai-brewet \
  --create-namespace
```

Or from a local checkout:

```bash
helm install rhoai-brewet chart/ \
  --namespace rhoai-brewet \
  --create-namespace
```

This creates a Deployment and Service for both the frontend (`rhoai-brewet`, serving `remoteEntry.js` via Nginx) and the BFF (`brewet-bff`, Node.js backend on port 3000). To deploy the frontend only, add `--set bff.enabled=false`.

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
      'name': 'rhoai-brewet',
      'namespace': 'rhoai-brewet',
      'port': 8080
    }
  },
  'proxyService': [{
    'path': '/rhoai-brewet/api',
    'pathRewrite': '/api',
    'authorize': True,
    'tls': False,
    'service': {
      'name': 'brewet-bff',
      'namespace': 'rhoai-brewet',
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

To work with the BFF (Namespace Summary page):

```bash
cd bff
npm install
K8S_API_BASE=$(oc whoami --show-server) npm run start:dev
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

- **[Architecture](docs/architecture/)** -- Plugin system internals and extension contract
- **[Development](docs/development/)** -- Local environment setup and backend API reference
- **[Deployment](docs/deployment/)** -- Deploying on OpenShift with Helm and dashboard registration

## License

Apache-2.0
