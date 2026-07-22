# Development Best Practices

Common pitfalls and development patterns for the Brewet plugin, distilled from real plugin development experience. Each section covers a category of bugs that are easy to introduce and hard to catch without integration testing.

## Storage Backend

### Path Validation

The storage backend exposes PVC-mounted directories to the user. Every path operation must validate against traversal attacks. Use `startsWith()` on resolved (absolute) paths, never `includes()`.

```typescript
// Bad — '../etc/passwd' can include '/allowed/path' if crafted correctly
if (requestedPath.includes(allowedBase)) { /* ... */ }

// Good — checks that the resolved path begins with the allowed directory
const resolved = path.resolve(requestedPath);
if (!resolved.startsWith(path.resolve(allowedBase))) {
  throw new SecurityError('Path traversal detected');
}
```

Additional path security checks in the storage backend:

- Reject null bytes (`\0`) in paths — they can truncate strings at the OS level.
- Reject symlinks that point outside the allowed directory.
- Normalize Unicode before path comparison (NFC normalization).
- Validate location IDs against the configured `LOCAL_STORAGE_PATHS`.

### S3 Operations

- **Connection pooling**: The AWS SDK v3 HTTP client reuses connections. Do not create a new `S3Client` per request — use the shared instance configured at startup.
- **Retry configuration**: S3 retries are configured globally. Individual route handlers should not add their own retry loops on top, or users see exponential delays.
- **MD5 checksums**: The SDK middleware computes checksums for upload integrity. Do not disable this for performance — silent data corruption is worse than latency.
- **Error mapping**: S3 errors (e.g., `NoSuchBucket`, `AccessDenied`) should be mapped to appropriate HTTP status codes. Never return raw AWS SDK error objects — they contain internal metadata (account IDs, ARNs) that should not be exposed.

```typescript
// Bad — leaks AWS internals
res.status(500).send(error);

// Good — controlled error response
if (error.name === 'NoSuchBucket') {
  reply.status(404).send({ error: 'Bucket not found' });
} else if (error.name === 'AccessDenied') {
  reply.status(403).send({ error: 'Access denied to S3 resource' });
} else {
  reply.status(500).send({ error: 'S3 operation failed' });
}
```

### SSE Streaming

The storage backend uses Server-Sent Events for transfer progress and HuggingFace imports. Common pitfalls:

- **Check `res.destroyed` before writing**: The client may disconnect mid-transfer. Writing to a destroyed response throws and can crash the process if uncaught.
- **Send keep-alive comments**: Proxies and load balancers close idle connections. The `setupKeepAlive` utility sends `: keep-alive\n\n` every 15 seconds.
- **Clean up on disconnect**: Register a `close` event handler on the response to abort in-flight operations (transfers, downloads) when the client disconnects.
- **Hijack before writing**: Fastify requires `reply.hijack()` before writing raw SSE data. Without it, Fastify's own response handling interferes.

### Transfer Queue

- **Concurrency limits**: The `TransferQueue` uses `p-limit` to cap concurrent file operations. Respect this limit — do not bypass it for "just one more" operation.
- **Abort support**: Every transfer must check the abort signal between file operations. A transfer of 1,000 files should not continue after the user cancels.
- **Progress accuracy**: Report progress based on bytes transferred, not file count. A 1 GB file and a 1 KB file should not show equal progress increments.

## BFF Proxy

### Auth Token Forwarding

The BFF forwards the user's Bearer token to the storage backend for audit logging, but the storage backend itself has no auth enforcement. The BFF is the security boundary.

- **Always validate the token exists**: Return 401 if the `Authorization` header is missing, before attempting to proxy.
- **Never log token values**: Log that a token was present/absent, not the token itself.
- **Sanitize forwarded headers**: Strip `x-forwarded-*` headers from incoming requests and set them to known values. The BFF already does this — do not remove the sanitization.

```typescript
// Bad — crashes with unhelpful error if token is undefined
const token = req.token!;

// Good — returns a clear 401 response
const token = req.headers.authorization;
if (!token) {
  return res.status(401).json({ message: 'Authentication required' });
}
```

### Streaming Proxy

The BFF proxies SSE, file downloads, and multipart uploads. These are the most fragile parts of the system:

- **Do not buffer responses**: The BFF uses `http-proxy` specifically to avoid buffering. The dashboard's `/api/k8s` proxy buffers entire responses (corrupting binary data and breaking SSE). Never switch to a buffering proxy.
- **Handle proxy errors after headers are sent**: Once `res.headersSent` is true, you cannot send an error JSON response. Log the error and destroy the connection.
- **Cache invalidation on error**: When a proxy request fails with `ECONNREFUSED` or `ECONNRESET`, clear the service discovery cache for that namespace. The storage backend may have been restarted with a new IP.

### Input Validation

- **Namespace names**: Validate against the K8s namespace regex (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`) at the route boundary. Never pass unvalidated namespace strings to service discovery.
- **Rate limiting**: The BFF applies rate limiting per client. If you add new routes, ensure they go through the rate limiter middleware.

## React Frontend

### Cleanup with Refs

Hook cleanup functions run after re-renders. If the cleanup captures a variable from the render closure, it uses the stale value. Use a ref to ensure cleanup always acts on the current value.

```typescript
// Bad — cleanup captures stale controller from the render that created it
useEffect(() => {
  const controller = new AbortController();
  fetchData(controller.signal);
  return () => controller.abort();
}, [dependency]);

// Good — ref always points to the latest controller
const controllerRef = useRef<AbortController>();
useEffect(() => {
  controllerRef.current?.abort();
  controllerRef.current = new AbortController();
  fetchData(controllerRef.current.signal);
  return () => controllerRef.current?.abort();
}, [dependency]);
```

### Error Boundary Keying

Key error boundaries by navigation parameters. Without a key, navigating from one errored item to another keeps the error boundary in its error state instead of resetting.

```tsx
<ErrorBoundary key={locationId}>
  <StorageBrowser locationId={locationId} />
</ErrorBoundary>
```

### Accessibility

- **Narrow `aria-live` regions**: Wrapping an entire `PageSection` with `aria-live="polite"` causes screen readers to re-announce the full DOM subtree on every status change. Wrap only the text that actually changes (e.g., transfer progress, container status).
- **Skeleton screen readers**: Add `screenReaderText` to PatternFly `Skeleton` components so assistive technology users know content is loading.
- **File browser focus management**: After upload, delete, or folder creation, move focus to the affected item or back to the table. Do not leave focus in a destroyed dialog.

### PatternFly Conventions

- Use PatternFly utility classes (`pf-v6-u-mt-md`) instead of inline styles for spacing, alignment, and sizing.
- Use accurate action labels that describe what happened (e.g., "Copied to clipboard"), not labels describing when the button appears.
- Use `EmptyState` components for zero-data states (empty buckets, no storage locations). Do not render an empty table with no explanation.

## Helm Chart Templates

### Type Coercion

Helm values are strings by default. Numeric values in templates need the `| int` filter, or comparisons and arithmetic behave unexpectedly.

```yaml
# Bad — port is a string, may cause issues in some K8s fields
containerPort: {{ .Values.service.port }}

# Good — explicitly cast to integer
containerPort: {{ .Values.service.port | int }}
```

### Name Truncation

Helm's `trunc 63` idiom limits names to 63 characters (K8s label value limit). Test with maximum-length release names and verify that suffixes like `-bff` still fit after truncation.

### Resource Policies

Add `helm.sh/resource-policy: keep` to PersistentVolumeClaims and Secrets that contain generated credentials. Without this annotation, `helm uninstall` deletes them and the data is lost.

### Value Validation

Document constraints directly in `values.yaml` comments: allowed character sets, valid ranges, maximum lengths. This is the first place developers look when configuring a chart.

### Label Consistency

Label selectors in application code (when listing storage backend services via `serviceDiscovery.ts`) must exactly match the labels rendered by Helm templates. A mismatch means the BFF cannot discover storage backends. Test selectors against actual rendered output using `helm template`.

## Security

### Error Exposure

Never forward raw internal error objects to HTTP clients. Extract only the user-facing message.

```typescript
// Bad — leaks stack traces, internal paths, K8s API details
res.status(500).json(error);

// Good — controlled error response
res.status(500).json({
  message: error instanceof Error ? error.message : 'Internal server error',
});
```

### NetworkPolicy

The storage backend has no application-level authentication. Security depends entirely on the NetworkPolicy restricting ingress to the BFF namespace. If you modify the Helm chart's NetworkPolicy template, verify that:

- Only the BFF namespace can reach the storage backend.
- The storage backend cannot initiate outbound connections to other namespaces (except S3 endpoints).

### CORS

If origin checks validate a port number, reject port 0 and ports above 65535. These are invalid but may pass naive range checks.

### Auth Coverage

Every non-health BFF route must have authentication middleware. The simplest test: send a request without a `Bearer` token and confirm a 401 response.

## Cross-Component Contract Testing

These tests verify that independently developed components (frontend hooks, BFF routes, storage backend routes, Helm templates) agree on their shared contracts.

| What to Test | Producer | Consumer |
|---|---|---|
| BFF proxy paths | BFF route strips `/brewet/api/:namespace/` prefix | Storage backend expects `/api/...` paths |
| SSE event names | Storage backend emits `progress`, `complete`, `error` events | Frontend `EventSource` listeners handle each event type |
| API response shapes | Storage backend route returns a structure | Frontend hook parses and displays the structure |
| Label selectors | Helm template renders labels on Deployments/Services | BFF `serviceDiscovery.ts` uses the same labels to find backends |
| Status/phase enums | K8s API returns Deployment status values | Frontend handles every value (including unknown ones) |
| Auth token forwarding | Dashboard forwards Bearer token → BFF extracts it | BFF proxies it → storage backend receives it in headers |

A mismatch in any of these contracts causes failures that only surface during integration testing.

## Pre-PR Checklist

A condensed checklist to review before opening a pull request. Not every item applies to every PR — scan for relevance.

### Storage Backend

- [ ] Path validation uses `startsWith()` on resolved paths
- [ ] S3 errors are mapped to HTTP status codes, not forwarded raw
- [ ] SSE handlers check `res.destroyed` before writing
- [ ] Transfer operations check abort signals between files
- [ ] Promises have `.catch()` handlers (unhandled rejections crash Node.js)

### BFF

- [ ] Every non-health route has auth middleware
- [ ] Namespace parameters are validated against the K8s regex
- [ ] Proxy errors after `headersSent` are handled gracefully
- [ ] Service discovery cache is cleared on connection errors
- [ ] New routes go through the rate limiter

### Frontend

- [ ] `useEffect` cleanup uses refs, not closure-captured values
- [ ] Error boundaries are keyed by navigation parameters
- [ ] `aria-live` regions wrap only the changing text
- [ ] Skeletons have `screenReaderText`
- [ ] PatternFly utility classes used instead of inline styles
- [ ] Empty states use `EmptyState` components

### Helm

- [ ] Numeric values use `| int` in templates
- [ ] Name truncation tested with max-length release names
- [ ] PVCs and credential Secrets have `resource-policy: keep`
- [ ] Value constraints documented in `values.yaml` comments
- [ ] Label selectors match rendered template labels

### Cross-Component

- [ ] BFF proxy path stripping matches storage backend route registration
- [ ] SSE event names are consistent between producer and consumer
- [ ] API response shapes match between backend tests and frontend tests
- [ ] Label selectors match rendered Helm template labels
- [ ] Auth token forwarding tested end-to-end
