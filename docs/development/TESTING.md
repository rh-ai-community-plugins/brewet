# Testing

How to run tests, what to test across component boundaries, and integration test scenarios for the Brewet plugin.

## Running Automated Tests

### Frontend

```bash
npm test                # Run all frontend tests (Jest + jsdom)
npm run test:watch      # Watch mode — re-runs on file changes
npm run test:coverage   # Tests with coverage report
```

To run a single test file:

```bash
npx jest src/app/hooks/useProjects.spec.ts
```

### BFF

```bash
cd bff
npm test                # Run BFF tests (Jest + node)
```

### Storage Backend

```bash
cd storage-backend
npm test                # Run storage backend tests (Jest + node)
```

### Linting

```bash
npm run lint                        # ESLint (src/) + markdownlint (**/*.md)
cd bff && npm run lint              # ESLint (bff/src/)
cd storage-backend && npm run lint  # ESLint (storage-backend/src/)
```

## Contract Testing Principles

Brewet has three independently developed layers — frontend, BFF, and storage backend — that must agree on shared contracts. Unit tests within a single layer cannot catch mismatches between layers. Contract tests verify these boundaries explicitly.

### What to Test

| Contract | How to Verify |
|---|---|
| **API response shapes** | Assert the same response structure in both the storage backend route test (producer) and the frontend hook test (consumer). If either side changes the shape, the other side's test fails. |
| **BFF proxy path mapping** | Verify that the BFF strips the `/brewet/api/:namespace/` prefix correctly and forwards `/api/...` to the storage backend. A path mismatch silently returns 404s. |
| **SSE event contracts** | The storage backend emits specific SSE event names (`progress`, `complete`, `error`). The frontend listens for these exact strings. A rename on one side silently breaks the other. |
| **Label selectors** | Render Helm templates with `helm template` and assert that the labels on Deployments and Services match the selectors in `serviceDiscovery.ts` and the frontend's K8s resource queries. |
| **Status/phase enums** | The frontend displays Deployment status values. Test that all known values (`Running`, `Pending`, `Failed`, etc.) plus an `unknown`/default case are handled in the UI. |
| **Auth token forwarding** | Test the full chain: dashboard sends Bearer token → BFF middleware extracts it → BFF proxies it to the storage backend. A missing or malformed token at any step should produce a clear 401. |

### Example: API Shape Contract

The storage backend route test asserts what the endpoint returns:

```typescript
// storage-backend/src/routes/api/buckets/index.test.ts
const response = await app.inject({ method: 'GET', url: '/api/buckets' });
expect(JSON.parse(response.body)).toEqual(
  expect.objectContaining({
    buckets: expect.arrayContaining([
      expect.objectContaining({
        name: expect.any(String),
        creationDate: expect.any(String),
      }),
    ]),
  }),
);
```

The frontend hook test asserts it can consume that shape:

```typescript
// src/app/hooks/useBuckets.spec.ts
mockFetch.mockResolvedValue({
  ok: true,
  json: () =>
    Promise.resolve({
      buckets: [{ name: 'my-bucket', creationDate: '2026-01-01T00:00:00Z' }],
    }),
});
const { result } = renderHook(() => useBuckets());
// assert hook exposes buckets correctly
```

If the storage backend renames `buckets` to `items`, the frontend test catches the mismatch before it reaches production.

### Example: SSE Event Contract

The storage backend emits transfer progress:

```typescript
// storage-backend/src/utils/sse.ts
sendSSEEvent(res, 'progress', { fileIndex: 0, totalFiles: 10, bytesTransferred: 1024 });
sendSSEEvent(res, 'complete', { totalFiles: 10, totalBytes: 10240 });
sendSSEEvent(res, 'error', { message: 'Access denied', fileIndex: 3 });
```

The frontend must handle all three event types:

```typescript
// Frontend EventSource listener
source.addEventListener('progress', (e) => updateProgress(JSON.parse(e.data)));
source.addEventListener('complete', (e) => markComplete(JSON.parse(e.data)));
source.addEventListener('error', (e) => showError(JSON.parse(e.data)));
```

Test that both sides agree on event names and data shapes.

## Integration Test Scenarios

Automated tests cover code correctness but cannot verify the full integration with the RHOAI dashboard and a live cluster. The scenarios below should pass before shipping. They surface issues that only appear when running against a real environment.

### Plugin Loading

- [ ] Plugin appears in the dashboard sidebar under Community Plugins > Brewet
- [ ] Clicking any Brewet nav item loads the page without errors
- [ ] Browser console shows no Module Federation errors or failed chunk loads
- [ ] CommunityBanner renders on all pages

### Container Lifecycle

- [ ] Creating a new Brewet container with a Data Connection and PVCs succeeds
- [ ] Container status shows "Running" after creation
- [ ] Stop scales replicas to 0, Start scales back to 1
- [ ] Deleting a container removes the Deployment, Service, and NetworkPolicy
- [ ] Container status updates are reflected in the toolbar

### Storage Browser

- [ ] S3 buckets list correctly after container starts
- [ ] PVC locations list correctly with configured mount paths
- [ ] File upload works (small file <1 MB)
- [ ] File upload works (large file >100 MB, verify streaming)
- [ ] File download returns correct content and MIME type
- [ ] Folder creation works in both S3 and PVC locations
- [ ] File deletion works (single and bulk select)
- [ ] File preview renders for supported file types
- [ ] Pagination works (navigate forward/back through large directories)
- [ ] Search filters the file list correctly

### Transfers

- [ ] S3 → PVC transfer starts and shows SSE progress
- [ ] PVC → S3 transfer starts and shows SSE progress
- [ ] S3 → S3 transfer works (cross-bucket)
- [ ] Transfer cancellation stops the operation
- [ ] Conflict detection warns before overwriting existing files
- [ ] Transfer of many files (>100) shows accurate progress

### BFF Proxy

- [ ] BFF endpoints return JSON, not an HTML error page
- [ ] Requests from the frontend reach the storage backend with correct path stripping
- [ ] SSE streams (transfer progress) pass through the BFF without buffering
- [ ] File downloads stream through the BFF without corruption (compare checksums)

### Authentication

- [ ] Auth token reaches BFF routes (check `Authorization` header in BFF logs)
- [ ] Requests without a Bearer token return 401, not a 500 or an HTML login page
- [ ] Token expiry produces a clear error, not a silent data-fetch failure

### RBAC and Permissions

- [ ] K8s API calls respect the user's RBAC permissions
- [ ] A user without access to a namespace sees an error, not a blank page
- [ ] Create/delete operations are hidden or disabled when RBAC denies access

### Error States

- [ ] Storage backend unreachable: plugin shows "start the container" message, not a blank page
- [ ] BFF unreachable: plugin shows a clear error
- [ ] Invalid or expired token: plugin shows an auth error
- [ ] Missing permissions: plugin shows a permission-denied message
- [ ] Network timeout: plugin recovers gracefully (shows error, allows retry)
- [ ] S3 connection failure: shows a meaningful error (not raw AWS SDK error)

### Loading States

- [ ] Pages show skeleton screens while data is loading, not blank pages
- [ ] Skeletons are announced to screen readers (`screenReaderText` on PatternFly Skeleton)
- [ ] After data loads, skeletons are replaced without flicker

### Navigation

- [ ] Selected project persists across page navigations (Storage Browser → Settings → back)
- [ ] Browser back/forward buttons work correctly within the plugin
- [ ] Deep-linking to a storage path (pasting a URL with locationId and path) loads correctly
- [ ] Switching projects clears stale data and reloads for the new project

### Settings

- [ ] Settings page loads with current configuration values
- [ ] Updating S3, HuggingFace, proxy, or pagination settings takes effect immediately
- [ ] Settings reset after container restart (ephemeral by design)
