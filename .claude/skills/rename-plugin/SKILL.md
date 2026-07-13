---
name: rename-plugin
description: This skill should be used when the user asks to "rename this plugin", "create a new plugin from this seed", "fork this plugin", "customize plugin identifiers", "change the plugin name", or wants to transform the hello-world seed project into a new RHOAI community plugin. Use proactively whenever the user indicates they want to create a new plugin based on this project.
---

# Rename Plugin

Automate renaming all plugin-specific identifiers when creating a new RHOAI community plugin from the `hello-world` seed project.

## When to Use

- The user wants to create a new plugin from this seed/scaffold project
- The user wants to rename all `hello-world` / `HelloWorld` identifiers to a new plugin name
- The user asks to customize or fork this project for a new plugin

## How It Works

The `scripts/rename-plugin.js` script derives all naming variants from a display name, replaces identifiers across ~33 files, renames icon files, updates icon initials and color, and prints post-rename steps.

## Workflow

### Step 1: Gather the Plugin Name

Ask the user for the **display name** of their new plugin (e.g., "My Cool Plugin"). All other variants are derived automatically:

| Variant      | Example                |
|-------------|------------------------|
| kebab-case  | `my-cool-plugin`       |
| camelCase   | `myCoolPlugin`         |
| PascalCase  | `MyCoolPlugin`         |
| snake_case  | `my_cool_plugin`       |
| Display     | `My Cool Plugin`       |
| Initials    | `MC`                   |

The user may also specify:

- A custom **dev server port** (default: `9500`)
- Custom **icon initials** (default: derived from first letters of the display name)
- Custom **icon color** (default: deterministically picked from a palette based on the kebab name)

### Step 2: Run the Script

Run the rename script in non-interactive mode:

```bash
node scripts/rename-plugin.js --name "Plugin Display Name" --yes
```

Available flags for overrides:

| Flag            | Purpose                              |
|----------------|--------------------------------------|
| `--name`       | Display name (required)              |
| `--kebab`      | Override kebab-case                  |
| `--camel`      | Override camelCase                   |
| `--pascal`     | Override PascalCase                  |
| `--snake`      | Override snake_case                  |
| `--display`    | Override display name                |
| `--port`       | Override dev server port             |
| `--initials`   | Override icon initials               |
| `--icon-color` | Override icon color (hex, e.g. `#0066cc`) |
| `--dry-run`    | Preview changes without applying     |
| `--yes` / `-y` | Skip confirmation prompt             |

### Step 3: Verify the Rename

After the script completes, run verification:

```bash
npm run lint && npm test
```

Both must pass with zero errors. If either fails, inspect and fix the issue before proceeding.

### Step 4: Communicate Post-Rename Steps

The script prints a checklist of manual steps. Relay these to the user clearly:

1. **Update `MODULE_FEDERATION_CONFIG`** in the dashboard's environment — the `name` field must match the new `camelCase` identifier, and `proxyService.path` must match `/{kebab}/api`.
2. **Restart ALL services** — the dashboard, plugin dev server, and BFF must all be restarted. The dashboard caches federation config at startup.
3. **Update container image repositories** — replace `quay.io/OWNER/` placeholders in `chart/values.yaml` and `.github/workflows/build-push.yml`.
4. **Update `plugin.yaml`** — set the `remoteEntry` URL to point to the deployed image location.

## Example

User: "Create a new plugin called Model Monitor"

```bash
node scripts/rename-plugin.js --name "Model Monitor" --yes
```

This renames all identifiers (`hello-world` → `model-monitor`, `HelloWorld` → `ModelMonitor`, etc.), updates icon to "MM" initials, and sets a deterministic icon color.

## What the Script Modifies

- **npm packages**: `package.json`, `bff/package.json`
- **Config**: `plugin.yaml`, `config/webpack.common.js`, `config/moduleFederation.js`, `config/webpack.dev.js`, `.env.development`
- **Source**: `src/bootstrap.tsx`, `src/rhoai/extensions.ts`, `src/app/hooks/useNamespaceSummary.ts`
- **Icon**: `src/app/components/HelloWorldNavIcon.tsx` (renamed + content updated)
- **Tests**: icon spec, extensions spec, namespace summary spec
- **Helm chart**: `chart/Chart.yaml`, `chart/values.yaml`, all templates
- **CI**: `.github/workflows/build-push.yml`, `scripts/build-push.sh`
- **Docs**: `README.md`, `CLAUDE.md`, and files under `docs/`
