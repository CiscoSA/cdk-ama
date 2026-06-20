# HANDOFF.md — Sharetribe Web Template

## Project Overview

React-based marketplace web application with server-side rendering (SSR), built on Sharetribe's template. Designed to run on AWS ECS.

**Stack**: React 18 + Redux Toolkit + Final Form + Express 5 + Node 22

## Architecture

```
├── config/            # Webpack config (be careful modifying)
├── scripts/           # Build, start, test, translations
├── server/
│   ├── index.js       # Express server entry point (production)
│   ├── apiRouter.js   # Server-side API endpoints
│   ├── dataLoader.js  # SSR data loading
│   ├── renderer.js    # Server-side rendering to string
│   ├── env.js         # .env file loading (dotenv)
│   ├── auth.js        # Basic auth middleware
│   ├── csp.js         # Content Security Policy
│   └── api/           # API handlers (login-as, privileged transitions, etc.)
├── src/
│   ├── components/    # Shared UI components (not connected to Redux)
│   ├── containers/    # Page-level components (connected to Redux)
│   ├── ducks/         # Shared Redux files (Ducks pattern)
│   ├── routing/       # Route configuration
│   ├── transactions/  # Transaction process definitions
│   ├── translations/  # i18n (en.json default)
│   ├── util/          # Utility helpers
│   ├── config/        # Built-in configs (overridden by hosted assets)
│   ├── app.js         # ClientApp and ServerApp exports
│   ├── index.js       # Client entry point
│   ├── reducers.js    # Combined reducers
│   └── store.js       # Redux store
└── build/             # Output (gitignored)
```

## Key Files to Know

| File | Purpose |
|------|---------|
| `server/index.js` | Production server. Listens on `PORT` env var. Healthcheck: `/_status.json` |
| `src/containers/pageDataLoadingAPI.js` | Register SSR `loadData` functions for routes |
| `src/routing/routeConfiguration.js` | All app routes |
| `src/config/configDefault.js` | Default app configuration |
| `src/util/configHelpers.js` | `mergeConfig` — validates/merges hosted + local config |
| `src/transactions/transaction.js` | Transaction process definitions (purchase, booking, inquiry, negotiation) |
| `src/components/index.js` | Shared component exports (import order matters) |

## Docker / Deployment

**Dockerfile**: Multi-stage build (deps → builder → runner). Final image runs as non-root user `appuser`.

**Required env vars for ECS**:
- `REACT_APP_SHARETRIBE_SDK_CLIENT_ID`
- `SHARETRIBE_SDK_CLIENT_SECRET`
- `REACT_APP_MARKETPLACE_NAME`
- `REACT_APP_MARKETPLACE_ROOT_URL`
- `PORT=3000`

**Optional env vars**:
- `REACT_APP_ENV=production`
- `REACT_APP_STRIPE_PUBLISHABLE_KEY`
- `REACT_APP_MAPBOX_ACCESS_TOKEN`
- `REACT_APP_FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`
- `REACT_APP_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD`
- `SERVER_SHARETRIBE_REDIRECT_SSL=true`
- `SERVER_SHARETRIBE_TRUST_PROXY=true`
- `REACT_APP_CSP=report|block`
- `REACT_APP_SENTRY_DSN`

## Hosted Configurations

The app fetches translations and config from Sharetribe SDK on full page load. These "hosted assets" override local configs in `src/config/`. Prefer using hosted configurations where possible. Full reference: https://www.sharetribe.com/docs/references/assets/

## Code Conventions

- **Styling**: Mobile-first CSS, two breakpoints (768px, 1024px). Use class selectors, not element selectors.
- **Forms**: Always React Final Form. Use shared `Field*` components from `src/components/index.js`.
- **Redux**: Redux Toolkit + Ducks pattern. Global ducks in `src/ducks/`, page-level in `src/containers/{Page}.duck.js`.
- **API calls**: Sharetribe SDK for marketplace API. Other calls go in `src/util/api.js`.
- **i18n**: React Intl `FormattedMessage` / `useIntl()`. Add strings to `src/translations/en.json`.
- **Imports**: Follow strict order: external libs → configs/util → shared components → parent dir → same dir.
- **Formatting**: Prettier — single quotes, 2 spaces, trailing commas, max 100 chars.

## Transaction Processes

4 built-in processes: `default-purchase`, `default-booking`, `default-inquiry`, `default-negotiation`. Each defined in `src/transactions/transactionProcess*.js`. Changes to processes require Sharetribe backend updates.

## Important Notes

- `NODE_ENV` must be set (server's `env.js` throws if missing)
- Mandatory env vars checked at server startup — app exits with code 9 if missing
- SSR uses `@loadable/component` for code splitting
- Server has graceful shutdown on SIGINT/SIGTERM
- Build output goes to `build/` (excluded from git and Docker context)
