---
name: add-bff-endpoint
description: This skill should be used when the user asks to "add a BFF endpoint", "add a backend route", "add an API endpoint", "create a backend-for-frontend route", "add a server-side endpoint", or wants to add a new Express route to the BFF service with a corresponding frontend hook. Use proactively whenever the user needs server-side data aggregation or a new backend API for the plugin.
---

# Add BFF Endpoint

Add a new Backend-For-Frontend (BFF) Express route that calls the Kubernetes API server-side, plus a matching frontend hook to consume it.

## Gather Information

Ask the user for:

1. **Endpoint purpose** (e.g., "list CRDs in a namespace", "get node status").
2. **Endpoint path** — kebab-case (e.g., `node-status`), becomes `/api/{endpoint-path}` on the BFF.
3. **K8s API path(s)** the endpoint should call (e.g., `/api/v1/nodes`).
4. **Response shape** — what fields the frontend needs.

Derive:

- `{endpointName}` — camelCase (e.g., `nodeStatus`)
- `{EndpointName}` — PascalCase (e.g., `NodeStatus`)
- `{endpoint-path}` — kebab-case URL segment (e.g., `node-status`)

Detect the plugin prefix by reading the `app.area` extension `id` in `src/rhoai/extensions.ts`. Call this `{plugin-id}`.

## Workflow

### Step 1 — Add BFF types

If the endpoint returns a new data shape, add response interfaces to `bff/src/types.ts`. Follow the existing pattern — define interfaces for the K8s resource shape and the aggregated response.

### Step 2 — Create the route handler

Create `bff/src/routes/{endpointName}.ts` following the pattern in `bff/src/routes/namespaceSummary.ts`:

```ts
import { Request, Response } from 'express';
import { k8sRequest } from '../utils/k8sClient';
import { /* types */ } from '../types';

export async function {endpointName}Handler(
  req: Request,
  res: Response,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  const token = authHeader.slice(7);

  try {
    const data = await k8sRequest<ResponseType>(token, '{k8s-api-path}');
    res.json(/* transformed response */);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('{EndpointName} error:', message);
    res.status(502).json({ error: message });
  }
}
```

Key conventions:

- Auth validation is inline (no middleware) — extract Bearer token, return 401 if missing.
- Use `k8sRequest<T>(token, path)` from `../utils/k8sClient` for all K8s calls.
- Return 502 on K8s call failures.
- Use `Promise.allSettled` when making multiple parallel K8s calls.

### Step 3 — Register the route

In `bff/src/server.ts`:

1. Import: `import { {endpointName}Handler } from './routes/{endpointName}';`
2. Register after existing routes: `app.get('/api/{endpoint-path}', {endpointName}Handler);`

Use `app.post` instead of `app.get` if the endpoint accepts a request body.

### Step 4 — Create the frontend hook

Create `src/app/hooks/use{EndpointName}.ts` following the pattern in `src/app/hooks/useNamespaceSummary.ts`:

```ts
import { useState, useEffect, useCallback } from 'react';

export type {ResponseType} = {
  // duplicate response types here — do not import from bff/
};

export function use{EndpointName}() {
  const [data, setData] = useState<{ResponseType} | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/{plugin-id}/api/{endpoint-path}')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res.json();
      })
      .then((json) => { setData(json); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}
```

Key conventions:

- Fetch URL is `/{plugin-id}/api/{endpoint-path}` — no Authorization header (the dashboard proxy injects it in production; webpack dev proxy forwards in development).
- Response types are duplicated in the hook file, not imported from `bff/`, since frontend and BFF are separate build targets.
- Return `{ data, loading, error, refresh }`.

### Step 5 — Create the BFF test

Create `bff/__tests__/{endpointName}.test.ts` following the pattern in `bff/__tests__/namespaceSummary.test.ts`:

- Mock `../src/utils/k8sClient` with `jest.mock`.
- Create a `createMockReqRes()` helper for Express Request/Response.

Required test cases:

1. Returns 401 when no Authorization header.
2. Returns 401 when Authorization is not Bearer.
3. Returns expected response on success — mock `k8sRequest` to return valid data.
4. Returns 502 on K8s failure — mock `k8sRequest` to reject.

Note: BFF tests use `.test.ts` extension and live in `bff/__tests__/`.

### Step 6 — Create the frontend hook test

Create `src/app/hooks/__tests__/use{EndpointName}.spec.ts` following the pattern in `src/app/hooks/__tests__/useNamespaceSummary.spec.ts`:

- Mock `global.fetch`.
- Use `renderHook` and `waitFor` from `@testing-library/react`.

Required test cases:

1. Success — mock fetch to resolve with data, verify `data` and `error` states.
2. Error — mock fetch with `ok: false`, verify error message.
3. Refresh — call `refresh()` via `act`, verify fetch was called twice.

Verify the fetch URL matches `/{plugin-id}/api/{endpoint-path}`.

Note: Frontend hook tests use `.spec.ts` extension and live in `src/app/hooks/__tests__/`.

### Step 7 — Verify webpack proxy

Read `config/webpack.dev.js` and confirm the BFF proxy entry exists:

```js
{
  context: ['/{plugin-id}/api'],
  target: 'http://localhost:3000',
  pathRewrite: { '^/{plugin-id}/api': '/api' },
}
```

This proxy covers all endpoints under `/{plugin-id}/api/*`, so no change is needed for additional endpoints. If the entry is missing (e.g., the plugin was created without BFF support), add it **before** the general `/{plugin-id}` proxy entry — order matters, more specific paths first.

### Step 8 — Verify

Run lint and tests for both frontend and BFF:

```bash
npm run lint && npm test
cd bff && npm test
```

All must pass with zero errors.

## Post-Task Checklist

- **Restart the BFF service** to pick up the new route: `cd bff && K8S_API_BASE=$(oc whoami --show-server) npm run start:dev`
- No `MODULE_FEDERATION_CONFIG` change is needed — BFF routing is separate from Module Federation.
- If the new endpoint accesses a K8s API path the user has not used before, RBAC permissions (ClusterRole / RoleBinding) may be required for that resource.
- To display this data in the UI, use the **add-page** skill to create a page that imports the hook.
