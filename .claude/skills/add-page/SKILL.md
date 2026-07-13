---
name: add-page
description: This skill should be used when the user asks to "add a page", "create a new page", "add a new view", "add a nav item", or wants to add a new routed page to the plugin with a sidebar navigation entry. Use proactively whenever the user wants to create a new page in the plugin.
---

# Add Page

Add a new routed page to the plugin with a navigation entry in the RHOAI dashboard sidebar.

## Gather Information

Ask the user for:

1. **Page title** (e.g., "Model Registry") — used for the nav label and page heading.
2. **Brief description** of what the page displays — drives the page body content and whether a data-fetching hook is needed.

Derive from the page title:

- `{PageName}` — PascalCase (e.g., `ModelRegistry`)
- `{page-slug}` — kebab-case (e.g., `model-registry`)

Detect the plugin prefix by reading the `app.area` extension `id` in `src/rhoai/extensions.ts`. After a rename this will differ from the seed value. Call this `{plugin-id}`.

## Workflow

### Step 1 — Create the page component

Create `src/app/pages/{PageName}Page.tsx` following the pattern in `src/app/pages/UserInfoPage.tsx`:

- Import `PageSection`, `Title`, `Content`, `Stack`, `StackItem` from `@patternfly/react-core`.
- Import a relevant icon from `@patternfly/react-icons`.
- If the page needs data, import the hook created in Step 6.
- Include a loading spinner (`Spinner` + `Bullseye`) and error alert (`Alert`) when using a hook.
- Export as default.

Minimal structure:

```tsx
import React from 'react';
import { PageSection, Title, Content, Stack, StackItem } from '@patternfly/react-core';
import { CubeIcon } from '@patternfly/react-icons';

const {PageName}Page: React.FC = () => (
  <PageSection>
    <Stack hasGutter>
      <StackItem>
        <Title headingLevel="h1" size="2xl">
          <CubeIcon /> {Page Title}
        </Title>
        <Content component="p">{description}</Content>
      </StackItem>
    </Stack>
  </PageSection>
);

export default {PageName}Page;
```

### Step 2 — Add the navigation extension

In `src/rhoai/extensions.ts`, add a new exported const before the `extensions` array:

```ts
export const {pageSlugCamel}NavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: '{plugin-id}-{page-slug}',
    title: '{Page Title}',
    href: '/{plugin-id}/{page-slug}',
    section: '{plugin-id}',
    path: '/{plugin-id}/{page-slug}/*',
  },
};
```

Add `{pageSlugCamel}NavExtension` to the `extensions` array. Insert it before the `app.route` entry (the route extension is always last).

### Step 3 — Add the route

In `src/app/App.tsx`:

1. Import the page component: `import {PageName}Page from './pages/{PageName}Page';`
2. Add a `<Route>` inside `<Routes>`, before `</Routes>`:

```tsx
<Route path="{page-slug}/*" element={<{PageName}Page />} />
```

Routes are relative — no leading `/{plugin-id}/` prefix.

### Step 4 — Update extension tests

In `src/rhoai/__tests__/extensions.spec.ts`:

1. Add the new nav extension to the import list.
2. Add a test case inside the navigation extensions describe block verifying `type`, `id`, `title`, `href`, `section`, and `path`.
3. Increment the `toHaveLength(N)` value by 1.
4. Add the new extension to the array order assertion, in the same position it appears in the source `extensions` array.

### Step 5 — Update App test

In `src/app/__tests__/App.spec.tsx` (if it exists):

1. Add a `jest.mock` for the new page component following the existing pattern.

### Step 6 — Create a data-fetching hook (if needed)

If the page fetches data, create `src/app/hooks/use{PageName}.ts` following the pattern in `src/app/hooks/useNamespaceSummary.ts`:

- Define response types at the top of the file.
- Use `useState` for `data`, `loading`, `error`.
- Use `useCallback` for `refresh` that calls `fetch(url)`.
- Use `useEffect` to call `refresh` on mount.
- Return `{ data, loading, error, refresh }`.
- For dashboard APIs: fetch from `/api/...`.
- For BFF endpoints: fetch from `/{plugin-id}/api/...` and use the **add-bff-endpoint** skill for the backend part.

Create the hook test at `src/app/hooks/__tests__/use{PageName}.spec.ts` following the pattern in `src/app/hooks/__tests__/useNamespaceSummary.spec.ts`:

- Mock `global.fetch`.
- Test success, error, and refresh scenarios.
- Use `renderHook` and `waitFor` from `@testing-library/react`.

### Step 7 — Verify

```bash
npm run lint && npm test
```

Both must pass with zero errors.

## Post-Task Checklist

- No `MODULE_FEDERATION_CONFIG` change is needed — pages use internal routing.
- No service restart is needed unless the dev server was stopped.
- If the page uses a new BFF endpoint, use the **add-bff-endpoint** skill for that part first.
