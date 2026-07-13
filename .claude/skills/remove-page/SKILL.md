---
name: remove-page
description: This skill should be used when the user asks to "remove a page", "delete a page", "drop a nav item", "remove a view", "clean up example pages", or wants to remove an existing routed page and its navigation entry from the plugin. Use proactively whenever the user wants to strip out a page they no longer need.
---

# Remove Page

Remove an existing routed page from the plugin, including its navigation entry, route, component file, associated hooks, and tests.

## Gather Information

Ask the user which page to remove. Identify it by title (e.g., "Namespace Summary") or file name.

Read `src/rhoai/extensions.ts` to find the matching `app.navigation/href` extension and its variable name. Read `src/app/App.tsx` to find the route and import. These confirm:

- `{PageName}` — PascalCase component name (e.g., `NamespaceSummary`)
- `{page-slug}` — kebab-case route segment (e.g., `namespace-summary`)
- `{navExtensionVar}` — the exported const name (e.g., `namespaceSummaryNavExtension`)

## Workflow

### Step 1 — Identify dependencies

Before deleting anything, determine what is exclusively used by this page:

1. Read `src/app/pages/{PageName}Page.tsx` and note any hooks imported from `~/app/hooks/`.
2. For each hook, grep the `src/` directory (excluding the page being removed) to check if any other file imports it. If no other file imports it, mark it for removal.
3. Check if any exclusive hooks fetch from `/{plugin-id}/api/...`. If so, identify the BFF route file under `bff/src/routes/` that serves that endpoint by reading `bff/src/server.ts`.

### Step 2 — Remove the page component

Delete `src/app/pages/{PageName}Page.tsx`.

Delete its test file if it exists (check `src/app/pages/__tests__/` or `src/app/__tests__/`).

### Step 3 — Remove the navigation extension

In `src/rhoai/extensions.ts`:

1. Remove the exported `const {navExtensionVar} = { ... };` declaration.
2. Remove `{navExtensionVar}` from the `extensions` array.

### Step 4 — Remove the route

In `src/app/App.tsx`:

1. Remove the import of the page component.
2. Remove the `<Route path="{page-slug}/*" ... />` element.
3. If the removed page was the default redirect target (the `<Navigate to="{page-slug}" replace />` element), update the `to` prop to point to a remaining page's slug.

### Step 5 — Remove exclusive hooks

For each hook marked for removal in Step 1:

1. Delete `src/app/hooks/use{HookName}.ts`.
2. Delete its test file at `src/app/hooks/__tests__/use{HookName}.spec.ts` (or `.test.ts`).

### Step 6 — Remove BFF endpoint (if applicable)

If the page used a BFF endpoint exclusively (identified in Step 1):

1. Delete the route handler file `bff/src/routes/{endpointName}.ts`.
2. In `bff/src/server.ts`, remove the import of the handler and the `app.get('/api/...',  ...)` line.
3. Delete the BFF test file `bff/__tests__/{endpointName}.test.ts`.
4. Remove any types from `bff/src/types.ts` that were exclusively used by the deleted handler. Grep `bff/src/` to confirm no other file references them before removing.
5. Check `config/webpack.dev.js` — the BFF proxy entry covers all endpoints under the plugin prefix, so do NOT remove it unless this was the last BFF endpoint. If it was the last one, remove the BFF proxy block.

### Step 7 — Update tests

In `src/rhoai/__tests__/extensions.spec.ts`:

1. Remove the import of the deleted nav extension variable.
2. Remove the test case that asserted on that nav extension.
3. Decrement the `toHaveLength(N)` value by 1.
4. Remove the entry from the array order assertion.

In `src/app/__tests__/App.spec.tsx` (if it exists):

1. Remove the `jest.mock` for the deleted page component.

### Step 8 — Verify

Run lint and tests for both frontend and BFF:

```bash
npm run lint && npm test
```

If a BFF endpoint was removed, also run:

```bash
cd bff && npm test
```

Both must pass with zero errors.

## Post-Task Checklist

- No `MODULE_FEDERATION_CONFIG` change is needed.
- If a BFF endpoint was removed, restart the BFF service.
- If the removed page was the only page, consider whether the plugin still needs the `app.route` extension and the `App.tsx` router.
