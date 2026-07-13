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
│       ├── App.tsx                  #   Router + CommunityBanner layout
│       ├── components/             #   Shared UI components
│       │   ├── CommunityBanner.tsx  #     [SHARED] "Community Plugin" banner — do not modify
│       │   ├── CommunityBanner.css  #     [SHARED] Banner styles — do not modify
│       │   ├── BrewetNavIcon.tsx#     [PLUGIN-SPECIFIC] Your plugin's sidebar icon
│       │   └── ProjectSelector.tsx #     Project selector with fuzzy search and favorites
│       ├── pages/                  #   One file per page/route
│       │   ├── UserInfoPage.tsx    #     Uses dashboard API pattern (/api/status)
│       │   ├── ClusterResourcesPage.tsx  # Uses K8s API pass-through (/api/k8s/*)
│       │   └── NamespaceSummaryPage.tsx  # Uses BFF pattern (plugin's own backend)
│       └── hooks/                  #   Data-fetching hooks
│           ├── useCurrentUser.ts   #     Dashboard API
│           ├── useProjects.ts      #     K8s API
│           ├── useFavoriteProjects.ts  # localStorage-backed project favorites
│           ├── useK8sResources.ts  #     K8s API (generic CRUD)
│           ├── useAccessReview.ts  #     RBAC check via SelfSubjectAccessReview
│           └── useNamespaceSummary.ts  # BFF call
├── config/                          # Webpack configs
│   ├── webpack.common.js            #   Module Federation setup, loaders, path alias (~ → src)
│   ├── webpack.dev.js               #   Dev server (port 9500), proxy rules
│   └── webpack.prod.js              #   Production build to dist/
├── bff/                             # Backend-For-Frontend service (optional — only if using BFF pattern)
│   └── src/
│       ├── server.ts                #   Express server entry
│       ├── types.ts                 #   Shared types (PodCounts, NamespaceInfo)
│       ├── routes/                  #   API route handlers
│       └── utils/                   #   K8s client helpers
├── chart/                           # Helm chart for OpenShift deployment
├── Makefile                         # Build, test, image, and chart targets (run `make help`)
├── plugin.yaml                      # Plugin metadata for the RHOAI registry
├── Containerfile                    # Frontend container (Nginx)
└── bff/Containerfile                # BFF container (Node.js)
```

## Codebase orientation

1. **`src/rhoai/extensions.ts`** — This is what the dashboard loads. It defines nav items and routes.
2. **Pages** live under `src/app/pages/`, with corresponding nav entries in `extensions.ts`.
3. **Hooks** under `src/app/hooks/` handle data fetching.

## Shared vs plugin-specific

Files marked `[SHARED]` are common to all community plugins. Do not rename, remove, or modify them — they ensure a consistent experience across the community plugin ecosystem:

| File | Purpose |
|---|---|
| `src/rhoai/CommunityNavIcon.tsx` | Common sidebar icon for the community-plugins nav section |
| `src/app/components/CommunityBanner.tsx` | "Community Plugin" banner displayed on every page |
| `src/app/components/CommunityBanner.css` | Styles for the banner |
| `communityPluginsSectionExtension` in `extensions.ts` | Shared nav section that groups all community plugins |

Everything else is yours to change. See [CUSTOMIZATION.md](CUSTOMIZATION.md) for the full list of identifiers to update.
