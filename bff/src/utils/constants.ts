/** Regex for valid Kubernetes namespace names (RFC 1123 DNS labels). */
export const K8S_NAMESPACE_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
