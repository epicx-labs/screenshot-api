import { serve } from '@hono/node-server';

import { createApp } from './app.js';

/**
 * Parses the server port from process environment.
 *
 * @returns Positive server port.
 */
function resolvePort(): number {
    const parsedPort = Number(process.env.PORT);
    return Number.isFinite(parsedPort) && parsedPort > 0
        ? Math.floor(parsedPort)
        : 3000;
}

/**
 * Resolves the server host from process environment.
 *
 * @returns Hostname used by the HTTP server.
 */
function resolveHost(): string {
    const host = process.env.HOST?.trim();
    return host && host.length > 0 ? host : '0.0.0.0';
}

const port = resolvePort();
const host = resolveHost();
const app = createApp();

serve({ fetch: app.fetch, port, hostname: host });
console.log(`Screenshot API listening on http://${host}:${port}`);
