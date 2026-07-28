# Project Layout

This is the directory structure of the Brewet plugin.

```text
.
├── src/
│   ├── index.ts                     # Webpack entry — dynamic import to bootstrap.tsx
│   ├── bootstrap.tsx                # React 18 root render (async bootstrap required by Module Federation)
│   ├── rhoai/                       # [DASHBOARD INTEGRATION] — what the host loads
│   │   ├── extensions.ts            #   Extension declarations (area, nav sections, nav items, route)
│   │   └── CommunityNavIcon.tsx     #   [SHARED] Sidebar icon for the community-plugins section — do not modify
│   └── app/                         # [PLUGIN CODE] — your actual plugin
│       ├── App.tsx                  #   Router + CommunityBanner + BrewetToolbar layout
│       ├── components/             #   Shared UI components
│       │   ├── CommunityBanner.tsx  #     [SHARED] "Community Plugin" banner — do not modify
│       │   ├── CommunityBanner.css  #     [SHARED] Banner styles — do not modify
│       │   ├── BrewetNavIcon.tsx    #     [PLUGIN-SPECIFIC] Wheelbarrow sidebar icon
│       │   ├── BrewetToolbar.tsx    #     Persistent toolbar: project selector, container status
│       │   ├── ContainerRequired.tsx #    Gate component requiring a running Brewet container
│       │   ├── ContainerWizard/    #     Multi-step wizard for creating/editing Brewet containers
│       │   ├── CreateProjectModal.tsx #   Modal for creating new OpenShift projects
│       │   ├── ErrorBoundary.tsx    #     Error boundary for graceful error display
│       │   ├── ProjectSelector.tsx  #     Project selector with fuzzy search and favorites
│       │   └── StorageBrowser/     #     Storage browser components
│       │       ├── StorageBrowser.tsx #     Main file browser (S3 + PVC)
│       │       ├── DocumentRenderer.tsx #  File preview renderer
│       │       ├── HuggingFaceImportModal.tsx # HuggingFace model import with SSE progress
│       │       └── TransferModal.tsx #     Cross-storage transfer with subfolder browser
│       ├── context/                #   React context providers
│       │   └── BrewetContext.tsx    #     Project selection, container status, settings
│       ├── pages/                  #   One file per page/route
│       │   ├── StorageBrowserPage.tsx    # Unified S3 + PVC file browser
│       │   ├── StorageManagementPage.tsx # Storage location management
│       │   └── SettingsPage.tsx          # Tabbed settings page
│       ├── hooks/                  #   Data-fetching hooks
│       │   ├── useProjects.ts      #     K8s API — list projects
│       │   ├── useBrewetContainer.ts #   Container lifecycle (create, start, stop, edit, delete)
│       │   ├── useDataConnections.ts #   List Data Connections (S3 credential Secrets)
│       │   ├── usePVCs.ts          #     List PersistentVolumeClaims
│       │   └── useSettingsTab.ts   #     Shared logic for settings tabs
│       ├── services/               #   API client layer
│       │   ├── apiClient.ts        #     Fetch wrapper with auth and error handling
│       │   └── storageService.ts   #     Storage operations (browse, upload, download, transfer, settings)
│       ├── types/                  #   TypeScript types
│       │   ├── k8s.ts              #     K8s resource types
│       │   └── storage.ts          #     Storage types (locations, files, transfers, settings)
│       └── utils/                  #   Shared utilities
│           ├── emitter.ts          #     Simple event emitter
│           ├── encoding.ts         #     URL-safe base64 encoding
│           ├── format.ts           #     formatBytes and other formatters
│           ├── k8sResources.ts     #     K8s resource builders (Deployment, Service, NetworkPolicy, Secret)
│           └── transferUtils.ts    #     Transfer path utilities
├── config/                          # Webpack configs
│   ├── webpack.common.js            #   Module Federation setup, loaders, path alias (~ → src)
│   ├── webpack.dev.js               #   Dev server (port 9500), proxy rules
│   └── webpack.prod.js              #   Production build to dist/
├── bff/                             # Backend-For-Frontend service
│   └── src/
│       ├── server.ts                #   Express server entry
│       ├── shutdown.ts              #   Graceful SIGTERM shutdown
│       ├── routes/
│       │   └── storageProxy.ts      #   Proxy: /api/:namespace/* → storage backend
│       ├── middleware/
│       │   └── rateLimiter.ts       #   Per-client-IP rate limiting
│       └── utils/
│           ├── k8sClient.ts         #   K8s API caller with typed errors
│           ├── serviceDiscovery.ts  #   Namespace → storage backend URL resolution
│           └── constants.ts         #   Shared constants
├── storage-backend/                 # Per-project storage backend (Fastify)
│   └── src/
│       ├── app.ts                   #   Fastify app setup
│       ├── server.ts                #   Server entry with settings sync from K8s Secret
│       ├── config/
│       │   └── cors.ts              #   CORS configuration
│       ├── routes/api/
│       │   ├── buckets/             #   S3 bucket operations
│       │   ├── objects/             #   S3 object + HuggingFace import operations
│       │   ├── local/               #   PVC filesystem operations
│       │   ├── transfer/            #   Cross-storage transfer operations
│       │   ├── settings/            #   Runtime settings management
│       │   └── info/                #   Server info endpoint
│       └── utils/                   #   Shared utilities (config, encoding, validation, etc.)
├── chart/                           # Helm chart for OpenShift deployment
├── scripts/                         # Build and version scripts
├── img/                             # Logo and image assets
├── Makefile                         # Build, test, image, and chart targets (run `make help`)
├── plugin.yaml                      # Plugin metadata for the RHOAI registry
├── Containerfile                    # Frontend container (Nginx)
├── bff/Containerfile                # BFF container (Node.js)
└── storage-backend/Containerfile    # Storage backend container (Node.js)
```

## Codebase orientation

1. **`src/rhoai/extensions.ts`** — This is what the dashboard loads. It defines nav items and routes.
2. **Pages** live under `src/app/pages/`, with corresponding nav entries in `extensions.ts`.
3. **Hooks** under `src/app/hooks/` handle data fetching and container lifecycle.
4. **Services** under `src/app/services/` provide the API client layer for storage operations.
5. **Context** (`src/app/context/BrewetContext.tsx`) manages project selection, container status, and settings.

## Shared vs plugin-specific

Files marked `[SHARED]` are common to all community plugins. Do not rename, remove, or modify them — they ensure a consistent experience across the community plugin ecosystem:

| File | Purpose |
|---|---|
| `src/rhoai/CommunityNavIcon.tsx` | Common sidebar icon for the community-plugins nav section |
| `src/app/components/CommunityBanner.tsx` | "Community Plugin" banner displayed on every page |
| `src/app/components/CommunityBanner.css` | Styles for the banner |
| `communityPluginsSectionExtension` in `extensions.ts` | Shared nav section that groups all community plugins |

Everything else is yours to change. See [CUSTOMIZATION.md](CUSTOMIZATION.md) for the full list of identifiers to update.
