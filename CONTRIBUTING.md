# Contributing to Economy Guardian

A concise guide to keep the codebase predictable, maintainable, and compliant.

## Core Principles

- Prefer centralized, single-ownership modules for UI behavior.
- Fail fast: do not add optional-chaining fallbacks around core services/controllers.
- Keep logic separated: Services (data), Controller (events/flow), Renderer (DOM/UI).
- No legacy helpers or global window fallbacks for export/copy/search.

## Frontend (companion/public/)

- Pattern per feature/tab:
  - Services: `*.services.js` (caching, persistence, helpers, API calls)
  - Renderer: `*.renderer.js` (DOM building, UI fragments)
  - Controller: `*.controller.js` (UI bindings, orchestration, hotkeys)
- Event bindings:
  - All DOM and keyboard handlers live in the Controller only.
  - Do not bind events in Services/Renderer or standalone scripts.
  - No inline event attributes in HTML (e.g., `onclick`, `oninput`, `onchange`).
  - No inline `<script>` blocks that attach listeners; load `*.controller.js` files instead.
  - Pages must include controllers after their core modules, e.g.:
    - `index.html`: load `app.js` then `app.controller.js`, and `index.controller.js`.
    - `top.html`: load `top.entry.js` which imports `top.controller.js`.
    - `player.html`: load `player.js` then `player.controller.js`.
    - `ai.html`: load `ai.js` then `ai.controller.js`.
  - Service Worker registration is centralized in `sw.controller.js`; include this on pages that need offline/cache support (top, index, player, ai).
  - Wowhead tooltips are centralized in `wowhead.controller.js`; include this in page `<head>`.
    - Do NOT inline `window.whTooltips` in HTML.
    - Do NOT include `https://wow.zamimg.com/js/tooltips.js` directly in HTML.
    - The controller sets `window.whTooltips` and injects the script once, idempotently.
    - Options for development/debugging:
      - `window.EG_WOWHEAD_SRC` can override the script URL.
      - URL param `?whsrc=wowhead|zamimg|off` selects source or disables tooltips for that load.
      - Persistent toggle: `window.EGTooltips.disable()` sets `localStorage.eg_tooltips=off` and reloads; `window.EGTooltips.enable()` removes it.
    - If your local server sends COEP/COOP headers, third-party scripts may be blocked; prefer removing such headers in dev or use a same-origin proxy if necessary.
- Centralized services:
  - Use `EGTopServices` (or feature-scoped services) directly from the controller.
  - Do not call `window.*` fallbacks like `window.EGTopServices?.` or duplicate helpers.
- Visibility source of truth:
  - Use `window.lastVisible` when exporting/copying visible rows.
- Keyboard shortcuts:
  - Owned by the Controller; guard against double-binding (e.g., `__eg*Bound` flags).

## Guardrails

- Script: `companion/scripts/check-legacy.js`
  - Enforces controller-only event bindings: flags `addEventListener` outside controller files and inline HTML handlers.
  - Detects legacy quick helpers and `window.*` fallbacks (export/copy) and optional-chaining fallbacks on `EGTopServices`/`EGTopController`.
  - Run locally: `node companion/scripts/check-legacy.js`
  - NPM: `npm run check:legacy` (on PowerShell, prefer direct `node`)
- Pre-commit hook:
  - Installed at `.githooks/pre-commit` and enabled via `git config core.hooksPath .githooks`.
  - Blocks commits if guardrail fails.
- CI:
  - GitHub Actions: `.github/workflows/guardrail.yml` runs on push and PR.

## Commit & PR Guidelines

- Keep PRs small and scoped; link to the feature or bug.
- Update README/CONTRIBUTING when changing patterns or guardrails.
- Add minimal tests or logging when fixing bugs that were hard to diagnose.

## Environment & Compliance

- Do not automate prohibited in-game actions.
- Store secrets in `.env`, never commit credentials.

Thanks for contributing and keeping the codebase clean and fast!

## Formatting & Linting

- **Install tools (once):** from `companion/`

```sh
npm install --save-dev eslint prettier
```

- **Format (write changes) for public assets:**

```sh
npm run format
```

- **Format check (CI-style, no writes):**

```sh
npm run format:check
```

- **Lint (report issues) and auto-fix:**

```sh
npm run lint
npm run lint:fix
```
