import { Hono } from 'hono';
import { z } from 'zod';

import {
    captureScreenshots,
    type ScreenshotOptions,
    type ScreenshotResult,
} from '../modules/screenshots/index.js';

const screenshotRequestSchema = z
    .object({
        url: z
            .string()
            .url()
            .refine((value) => {
                const protocol = new URL(value).protocol;
                return protocol === 'http:' || protocol === 'https:';
            }, 'URL must use http or https.'),
        waitForMs: z.number().int().nonnegative().optional(),
        resizeWaitMs: z.number().int().nonnegative().optional(),
        includeMobile: z.boolean().optional(),
    })
    .strict();

/** Dependencies and capacity settings for the HTTP application. */
export interface CreateAppOptions {
    /** Screenshot implementation; tests may provide an in-memory adapter. */
    captureScreenshotsFn?: (
        options: ScreenshotOptions,
    ) => Promise<ScreenshotResult>;
    /** Maximum captures running at once. */
    maxInFlight?: number;
    /** Maximum captures waiting to run. */
    maxQueue?: number;
    /** Retry delay returned with overload responses. */
    retryAfterSeconds?: number;
}

/** Work queue used to bound browser resource usage. */
interface ScreenshotQueue {
    /** Schedules work or returns `undefined` when full. */
    schedule: <T>(task: () => Promise<T>) => Promise<T> | undefined;
    /** Returns current running and waiting task counts. */
    state: () => { inFlight: number; queueDepth: number };
}

/** Pending work inside the screenshot queue. */
interface QueuedTask {
    /** Starts the queued work. */
    run: () => Promise<unknown>;
    /** Resolves the caller's promise. */
    resolve: (value: unknown) => void;
    /** Rejects the caller's promise. */
    reject: (error: unknown) => void;
}

/**
 * Converts an environment value to a positive integer.
 *
 * @param value - Raw environment value.
 * @param fallback - Value used when input is invalid.
 * @returns Positive integer.
 */
function positiveInteger(value: number | string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1
        ? Math.floor(parsed)
        : fallback;
}

/**
 * Creates a small FIFO queue for expensive browser captures.
 *
 * @param maxInFlight - Maximum tasks running at once.
 * @param maxQueue - Maximum tasks waiting to run.
 * @returns Bounded screenshot queue.
 */
function createScreenshotQueue(
    maxInFlight: number,
    maxQueue: number,
): ScreenshotQueue {
    let inFlight = 0;
    const waiting: QueuedTask[] = [];

    /** Starts queued work while capacity is available. */
    function drain(): void {
        while (inFlight < maxInFlight) {
            const task = waiting.shift();
            if (!task) {
                return;
            }

            inFlight += 1;
            void task
                .run()
                .then(task.resolve, task.reject)
                .finally(() => {
                    inFlight -= 1;
                    drain();
                });
        }
    }

    return {
        schedule<T>(run: () => Promise<T>): Promise<T> | undefined {
            if (inFlight >= maxInFlight && waiting.length >= maxQueue) {
                return undefined;
            }

            const promise = new Promise<T>((resolve, reject) => {
                waiting.push({
                    run: run as () => Promise<unknown>,
                    resolve: resolve as (value: unknown) => void,
                    reject,
                });
            });
            drain();
            return promise;
        },
        state: () => ({ inFlight, queueDepth: waiting.length }),
    };
}

/**
 * Creates the screenshot HTTP application.
 *
 * @param options - Optional capture adapter and capacity overrides.
 * @returns Configured Hono application.
 */
export function createApp(options: CreateAppOptions = {}): Hono {
    const capture = options.captureScreenshotsFn ?? captureScreenshots;
    const retryAfterSeconds = positiveInteger(
        options.retryAfterSeconds ?? process.env.RATE_LIMIT_RETRY_AFTER_SECS,
        10,
    );
    const queue = createScreenshotQueue(
        positiveInteger(options.maxInFlight ?? process.env.MAX_INFLIGHT, 1),
        positiveInteger(options.maxQueue ?? process.env.MAX_QUEUE, 50),
    );
    const app = new Hono();

    app.get('/', (context) =>
        context.json({ ok: true, message: 'Screenshot service ready' }),
    );
    app.get('/health', (context) => context.json({ ok: true }));
    app.post('/screenshots', async (context) => {
        let body: unknown;
        try {
            body = await context.req.json();
        } catch {
            return context.json(
                { ok: false, error: 'Invalid JSON body.' },
                400,
            );
        }

        const parsed = screenshotRequestSchema.safeParse(body);
        if (!parsed.success) {
            return context.json(
                {
                    ok: false,
                    error: 'Invalid request body.',
                    details: parsed.error.issues.map((issue) => ({
                        path: issue.path.join('.'),
                        message: issue.message,
                    })),
                },
                400,
            );
        }

        const url = new URL(parsed.data.url).toString();
        const screenshotOptions: ScreenshotOptions = {
            url,
            includeMobile: parsed.data.includeMobile ?? false,
            ...(parsed.data.waitForMs === undefined
                ? {}
                : { waitForMs: parsed.data.waitForMs }),
            ...(parsed.data.resizeWaitMs === undefined
                ? {}
                : { resizeWaitMs: parsed.data.resizeWaitMs }),
        };
        const scheduled = queue.schedule(() => capture(screenshotOptions));

        if (!scheduled) {
            return context.json(
                {
                    ok: false,
                    error: 'Too many requests. Try again later.',
                    ...queue.state(),
                },
                429,
                { 'Retry-After': retryAfterSeconds.toString() },
            );
        }

        try {
            const result = await scheduled;
            return context.json({
                ok: true,
                url,
                desktop: result.desktop,
                ...(result.mobile ? { mobile: result.mobile } : {}),
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Unexpected error.';
            return context.json({ ok: false, error: message }, 500);
        }
    });

    return app;
}
