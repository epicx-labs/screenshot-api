import { expect, test } from 'vitest';

import { createApp } from '../src/api/app.js';

/**
 * Sends a request through the public HTTP interface.
 *
 * @param app - Hono application.
 * @param pathname - Request pathname.
 * @param init - Optional request settings.
 * @returns HTTP response.
 */
function request(
    app: ReturnType<typeof createApp>,
    pathname: string,
    init?: RequestInit,
): Promise<Response> {
    return Promise.resolve(
        app.fetch(new Request(`http://localhost${pathname}`, init)),
    );
}

/**
 * Creates a promise whose completion is controlled by the test.
 *
 * @returns Deferred promise and resolver.
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

test('health route reports readiness', async () => {
    const response = await request(createApp(), '/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
});

test('root route identifies the screenshot service', async () => {
    const response = await request(createApp(), '/');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
        ok: true,
        message: 'Screenshot service ready',
    });
});

test('POST /screenshots preserves the success response', async () => {
    const app = createApp({
        captureScreenshotsFn: async () => ({
            desktop: { base64: 'desktop-base64' },
            mobile: { base64: 'mobile-base64' },
        }),
    });
    const response = await request(app, '/screenshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            url: 'https://example.com',
            includeMobile: true,
        }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
        ok: true,
        url: 'https://example.com/',
        desktop: { base64: 'desktop-base64' },
        mobile: { base64: 'mobile-base64' },
    });
});

test('POST /screenshots rejects invalid requests', async () => {
    const response = await request(createApp(), '/screenshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
    });
    const body = (await response.json()) as {
        error: string;
        details: unknown[];
    };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request body.');
    expect(body.details).toHaveLength(1);
});

test('POST /screenshots rejects malformed JSON', async () => {
    const response = await request(createApp(), '/screenshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'Invalid JSON body.',
    });
});

test('POST /screenshots returns capture failures', async () => {
    const app = createApp({
        captureScreenshotsFn: async () => {
            throw new Error('Capture failed.');
        },
    });
    const response = await request(app, '/screenshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'Capture failed.',
    });
});

test('POST /screenshots returns 429 when capacity is full', async () => {
    const firstCapture = createDeferred<{ desktop: { base64: string } }>();
    const app = createApp({
        maxInFlight: 1,
        maxQueue: 1,
        captureScreenshotsFn: async ({ url }) => {
            if (url.endsWith('/first')) {
                return firstCapture.promise;
            }
            return { desktop: { base64: 'queued' } };
        },
    });
    const send = (url: string) =>
        request(app, '/screenshots', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url }),
        });

    const first = send('https://example.com/first');
    const second = send('https://example.com/second');
    const overflow = await send('https://example.com/third');
    firstCapture.resolve({ desktop: { base64: 'first' } });
    await Promise.all([first, second]);

    expect(overflow.status).toBe(429);
    expect(overflow.headers.get('Retry-After')).toBe('10');
});
