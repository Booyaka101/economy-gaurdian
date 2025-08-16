# Economy Guardian (Retail, EU Twisting Nether / Twilight's Hammer Connected Realm)

An advanced, compliant WoW Auction House "sniper" stack consisting of:

- In-game addon `economy-guardian/addon/` for real-time scanning and safe buy flow.
- Node.js companion app `economy-guardian/companion/` for pricing, analytics, alerts, and dashboard.

Important compliance note: Addons cannot automate purchases. This project focuses on ultra-fast discovery, clear risk/price context, and safe confirmation flows.

## Structure

- `addon/`
  - `EconomyGuardian.toc`: Addon manifest.
  - `Core.lua`, `UI.lua`, `Scan.lua`, `Rules.lua`, `Price.lua`: Core modules.
  - `Bindings.xml`: Keybindings.
  - `Localization/enUS.lua`: Strings.
- `companion/`
  - `package.json`: Node app manifest.
  - `src/server.js`: Express HTTP server and dashboard scaffold.
  - `src/config.js`: Loads environment.
  - `src/integrations/`: Blizzard, TUJ, NexusHub, TSM, Discord, Telegram, Slack, Google Sheets (stubs).
  - `data/`: SQLite database (when created).
  - `.env.example`: Example environment configuration.

## Prereqs

- Retail WoW. Enable "Load out of date AddOns" if needed.
- Node.js 18+.

## Setup: Companion App

1. Copy `.env.example` to `.env` in `companion/` and fill credentials:
   - BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET
   - TSM_API_KEY (optional)
   - DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN+CHAT_ID, SLACK_WEBHOOK_URL (optional)
   - GOOGLE*SERVICE_ACCOUNT*\* (optional)
   - REALM_SLUGS (comma-separated), REGION="eu"
2. Install dependencies:
   - Run in `companion/`: `npm install`
3. Start server:
   - `npm start`
   - Visit http://localhost:4317/health

## Setup: Addon

- Place the `addon/` folder as `World of Warcraft/_retail_/Interface/AddOns/EconomyGuardian/`.
- In-game, open AH and use the Economy Guardian tab.

## Default Snipe Rules (initial)

- Price threshold: <= 40% of blended fair value.
- Max price: 100,000g.
- Include commodities.
- Exclude pure cosmetic transmog by default.
- Require explicit confirmation before buying.

You can tune these in `Rules.lua` or the in-game UI once implemented.

## Price Source Priority (blended)

1. TSM (if available)
2. The Undermine Journal (TUJ)
3. NexusHub
4. Blizzard historical (derived from Connected Realm auctions via companion)

## Roadmap

- Implement fair value blending with confidence scores.
- Add Discord/Telegram/Slack notifications.
- Add dashboard pages for deals, rules, charts, and performance.
- Ship SavedVariables import/export pipeline between companion and addon.

## Top Tab UI Centralization

The Top Sold tab in the dashboard has been fully centralized for maintainability and consistency.

- **Ownership**
  - `companion/public/top.services.js` provides all item meta caching, persistence, export/copy helpers (`EGTopServices`).
  - `companion/public/top.controller.js` owns all UI event bindings, refresh logic, keyboard shortcuts, and uses `EGTopServices` exclusively.
  - `companion/public/top.renderer.js` renders rows and page info. It is imported by the controller.
- **Load order**
  1. `top.services.js`
  2. `top.renderer.js`
  3. `top.controller.js` (or `top.entry.js` ESM entry which bootstraps the controller)
- **Strict, fail-fast behavior**
  - Legacy global helpers and fallback button listeners in `top.js` are removed.
  - All export/copy/search flows route only through `EGTopServices` and controller bindings.
  - Global keyboard shortcuts are centralized in the controller (Ctrl+Shift+E/C/G, '/', '?', ESC, R, D).
  - `window.lastVisible` is used as the single source for visible items when exporting/copying.
  - **Implementation notes**
    - The controller sets guards (e.g., `__egTop*` flags) to avoid double-binding.
    - If you add new UI actions in Top tab, bind them in `attachHandlers()` and delegate to `EGTopServices`.
    - See also: [CONTRIBUTING.md](./CONTRIBUTING.md) for centralization policies.
  
  - **Handlers module and imports**
    - Handlers live in `companion/public/top.handlers.controller.js` and are imported directly by `top.controller.js`.
    - The legacy/shim file `top.handlers.js` was removed to avoid confusion and ensure guardrail compliance.

## Code Quality Guardrails

To prevent reintroduction of legacy fallbacks and duplicate bindings, the companion app includes guardrails:

- **Guardrail script**
  - File: `companion/scripts/check-legacy.js`
  - Run locally: `node companion/scripts/check-legacy.js`
  - NPM: `npm run check:legacy` (PowerShell may require direct `node` invocation)
  - Flags any usage of legacy quick helpers or optional-chaining fallbacks on `window.EGTopServices` / `window.EGTopController`, and any `window.exportVisible*` / `window.copyVisible*` calls in `companion/public/`.
- **Pre-commit hook**
  - Hook: `.githooks/pre-commit`
  - Git config: `git config core.hooksPath .githooks`
  - Blocks commits when the guardrail script fails.
- **CI workflow**
  - File: `.github/workflows/guardrail.yml`
  - Runs guardrail on every push and pull request.
  - See also: [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor policies.

## Disclaimer

This project is community-built and provided as-is. Respect Blizzard ToS and third-party API terms. No automation of disallowed actions.
