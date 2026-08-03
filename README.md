# Screenshot API

Standalone TypeScript API for clean desktop and optional mobile screenshots.
It runs Playwright through Crawlee and deploys as a Docker service on Dokploy.

## Requirements

- Node.js 26.5.1+
- pnpm 11.18.0
- Docker

## Install and verify

```bash
pnpm install
pnpm run check
pnpm run typecheck
pnpm test
pnpm run build
```

## Run

Docker development with hot reload:

```bash
cp .env.example .env
pnpm dev
```

Direct source watcher:

```bash
pnpm run dev:server
```

Compiled production server:

```bash
pnpm run build
pnpm start
```

Docker Compose exposes the API at `http://localhost:4000`. The direct server
uses `http://localhost:3000` by default.

## API

- `GET /` — readiness.
- `GET /health` — health check.
- `POST /screenshots` — captures desktop and optionally mobile screenshots.

Request:

```json
{
    "url": "https://example.com",
    "waitForMs": 1000,
    "resizeWaitMs": 500,
    "includeMobile": true
}
```

`waitForMs`, `resizeWaitMs`, and `includeMobile` are optional. The existing
`/screenshots` request and response contract is unchanged.

## Capacity

| Variable | Default | Purpose |
| --- | ---: | --- |
| `MAX_INFLIGHT` | 1 | Concurrent screenshot requests |
| `MAX_QUEUE` | 50 | Queued screenshot requests |
| `RATE_LIMIT_RETRY_AFTER_SECS` | 10 | `Retry-After` value for `429` responses |
| `LOG_LEVEL` | `info` | Minimum structured log level |

## E2E contract test

```bash
pnpm run test:e2e
```

The test builds the production image, starts a local fixture site, verifies the
frozen `/screenshots` response shapes, and removes the temporary stack.
