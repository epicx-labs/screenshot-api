# Self-Hosted Website Screenshot API

A self-hosted website screenshot API that turns any public URL into a clean PNG
image. This open-source URL-to-PNG API is built with TypeScript,
Playwright, Hono, and headless Chromium.

The API removes common cookie banners and popups, prepares lazy-loaded media,
stops animations, and returns the screenshot as base64 JSON. Every request
includes a desktop capture and can optionally include a responsive mobile
capture.

Source: [GitHub repository](https://github.com/epicx-labs/screenshot-api)

## Features

- Self-hosted Playwright screenshot API with a small HTTP interface.
- Clean webpage screenshots without common consent banners, popups, or
  animations.
- Independent desktop and mobile browser contexts for responsive screenshots.
- Base64-encoded PNG responses for easy storage or embedding.
- Docker image with headless Chromium included.
- Bounded capture queue with HTTP `429` backpressure.

Use it as a Docker screenshot API for automated website previews, visual QA,
content snapshots, link previews, or other server-side webpage capture
workflows.

## Quick start with Docker

Docker is the easiest way to run the API because Chrome is already included.

```bash
docker build -t screenshot-api .
docker run --rm -p 3000:3000 screenshot-api
```

Check that it is ready:

```bash
curl http://localhost:3000/health
```

Capture a screenshot:

```bash
curl -X POST http://localhost:3000/screenshots \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'
```

## API

### `POST /screenshots`

Request body:

```json
{
    "url": "https://example.com",
    "waitForMs": 1000,
    "resizeWaitMs": 500,
    "includeMobile": true
}
```

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `url` | Yes | — | HTTP or HTTPS page to capture |
| `waitForMs` | No | `1000` | Extra wait after the page loads |
| `resizeWaitMs` | No | `500` | Wait while lazy media loads |
| `includeMobile` | No | `false` | Include a `390 × 844` mobile capture |

Successful response:

```json
{
    "ok": true,
    "url": "https://example.com/",
    "desktop": {
        "base64": "iVBORw0KGgo..."
    },
    "mobile": {
        "base64": "iVBORw0KGgo..."
    }
}
```

`mobile` is omitted unless `includeMobile` is `true`.

Validation failure:

```json
{
    "ok": false,
    "error": "Invalid request body.",
    "details": [
        {
            "path": "url",
            "message": "Invalid input: expected string, received undefined"
        }
    ]
}
```

Capture failures return HTTP `500`. When the configured capture queue is full,
the API returns HTTP `429` with a `Retry-After` header.

### Health routes

- `GET /health` returns `{ "ok": true }`.
- `GET /` returns a short readiness message.

## What “clean” means

Before each viewport is captured, the API:

1. Dismisses or hides common consent banners, modals, popups, and floating
   widgets.
2. Scrolls near the fold to trigger lazy images, videos, and embeds.
3. Returns to the top of the page.
4. Disables animations, transitions, smooth scrolling, and text carets.
5. Pauses videos.
6. Runs blocker cleanup once more for late popups.

Cleanup is best-effort. A site-specific cleanup failure does not discard an
otherwise valid screenshot.

Desktop and mobile screenshots load in separate browser contexts so responsive
layouts are captured independently.

## Local development

Requirements:

- Node.js 26.5.1 or newer
- pnpm 11.18.0

Install the project and Playwright browser:

```bash
nvm install
nvm use
npm install --global pnpm@11.18.0
pnpm install
pnpm exec playwright install chromium
```

Start the TypeScript development server:

```bash
cp .env.example .env
pnpm run dev:server
```

The server listens on `http://localhost:3000` by default.

For Docker development with source mounting and hot reload:

```bash
cp .env.example .env
pnpm dev
```

Docker Compose exposes the API at `http://localhost:4000`.

## Configuration

| Variable | Default | Description |
| --- | ---: | --- |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `3000` | Server port |
| `MAX_INFLIGHT` | `1` | Captures allowed to run simultaneously |
| `MAX_QUEUE` | `50` | Captures allowed to wait |
| `RATE_LIMIT_RETRY_AFTER_SECS` | `10` | `Retry-After` value for HTTP `429` |
| `PLAYWRIGHT_EXECUTABLE_PATH` | Playwright default | Optional Chrome executable path |

## Build and test

```bash
pnpm run check
pnpm run typecheck
pnpm test
pnpm run build
```

Run the Docker-backed contract tests:

```bash
pnpm run test:e2e
```

The E2E suite builds the production image, starts a fixture website, verifies
the public response shapes, and removes its temporary containers.

## Project structure

```text
src/api/                         HTTP routes and server entry point
src/modules/screenshots/         Playwright capture and page cleanup
tests/                           Unit tests
tests/e2e/                       Docker-backed contract tests
```

## Related project

This project is open-sourced by [Keytomic](https://keytomic.com), an AI SEO
automation platform for Google and LLM visibility.

## Security

The API can visit arbitrary URLs. Do not expose it publicly without
authentication, request limits, and outbound network restrictions. Otherwise,
users may be able to reach private or local network addresses from the server.

## Contributing

1. Create a focused branch.
2. Add or update tests for behavior changes.
3. Run `pnpm run check`, `pnpm run typecheck`, `pnpm test`, and
   `pnpm run build`.
4. Open a pull request explaining the user-visible change.

## License

ISC
