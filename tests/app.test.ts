import { expect, test } from 'vitest';

import { createApp } from '../src/api/app.js';
import type { ScreenshotRequest } from '../src/types.js';

/**
 * Sends a request through the public Hono fetch interface.
 *
 * @param fetch - Application fetch handler.
 * @param pathname - API pathname.
 * @param init - Optional request configuration.
 * @returns HTTP response.
 */
function request(
    fetch: (request: Request) => Response | Promise<Response>,
    pathname: string,
    init?: RequestInit,
): Promise<Response> {
    return Promise.resolve(
        fetch(new Request(`http://localhost${pathname}`, init)),
    );
}

/**
 * Creates a deferred promise for queue saturation tests.
 *
 * @returns Promise with manual resolver.
 */
function createDeferred<T>(): {
    /** Deferred promise. */
    promise: Promise<T>;
    /** Resolves the deferred promise. */
    resolve: (value: T) => void;
} {
    let resolveRef: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        resolveRef = resolve;
    });
    return { promise, resolve: resolveRef };
}

test('health route reports the screenshot service is ready', async () => {
    const { app } = createApp();
    const response = await request(app.fetch, '/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
});

test('root route identifies the standalone screenshot service', async () => {
    const { app } = createApp();
    const response = await request(app.fetch, '/');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
        ok: true,
        message: 'Screenshot service ready',
    });
});

test('crawler routes are not exposed by the screenshot service', async () => {
    const { app } = createApp();
    const response = await request(app.fetch, '/crawl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
    });

    expect(response.status).toBe(404);
});

test('POST /screenshots preserves the existing success contract', async () => {
    const { app } = createApp({
        dependencies: {
            captureScreenshotsFn: async () => ({
                desktop: { base64: 'desktop-base64' },
                mobile: { base64: 'mobile-base64' },
            }),
        },
    });
    const payload: ScreenshotRequest = {
        url: 'https://example.com',
        includeMobile: true,
    };
    const response = await request(app.fetch, '/screenshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
        ok: true,
        url: 'https://example.com/',
        desktop: { base64: 'desktop-base64' },
        mobile: { base64: 'mobile-base64' },
    });
});

test('POST /screenshots preserves validation errors', async () => {
    const { app } = createApp();
    const response = await request(app.fetch, '/screenshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
    });
    const body = (await response.json()) as {
        ok: boolean;
        error: string;
        details: unknown[];
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Invalid request body.');
    expect(body.details).toHaveLength(1);
});

test('POST /screenshots returns 429 when its queue is full', async () => {
    const firstJob = createDeferred<{ desktop: { base64: string } }>();
    const { app } = createApp({
        maxInFlight: 1,
        maxQueue: 1,
        dependencies: {
            captureScreenshotsFn: async (options) => {
                if (options.url.endsWith('/first')) {
                    return firstJob.promise;
                }
                return { desktop: { base64: 'queued' } };
            },
        },
    });
    const send = (url: string) =>
        request(app.fetch, '/screenshots', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url }),
        });

    const first = send('https://example.com/first');
    const second = send('https://example.com/second');
    const overflow = await send('https://example.com/third');
    firstJob.resolve({ desktop: { base64: 'first' } });
    await first;
    await second;

    expect(overflow.status).toBe(429);
    expect(overflow.headers.get('Retry-After')).toBe('10');
});
