import crypto from 'node:crypto';

import { Hono } from 'hono';

import {
    captureScreenshots,
    type ScreenshotOptions,
    type ScreenshotResult,
} from '../modules/screenshots/index.js';
import { screenshotRequestSchema } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { createMetrics } from '../utils/metrics.js';
import {
    DEFAULT_MAX_IN_FLIGHT,
    DEFAULT_MAX_QUEUE,
    DEFAULT_RETRY_AFTER_SECONDS,
    parsePositiveInt,
    resolvePositiveIntOption,
    resolveRequestId,
} from './config.js';
import type { RateLimitConfig } from './rate-limit.js';
import { createTaskScheduler } from './task-scheduler.js';

/** External dependencies used by the screenshot API. */
export interface AppDependencies {
    /** Captures screenshots for a validated request. */
    captureScreenshotsFn: (
        options: ScreenshotOptions,
    ) => Promise<ScreenshotResult>;
    /** Creates request identifiers for logs. */
    createRequestId: () => string;
}

/** Options used to construct a screenshot API instance. */
export interface CreateAppOptions {
    /** Optional dependency overrides for testing. */
    dependencies?: Partial<AppDependencies>;
    /** Optional concurrent task override. */
    maxInFlight?: number;
    /** Optional queued task override. */
    maxQueue?: number;
    /** Optional `Retry-After` override in seconds. */
    retryAfterSeconds?: number;
}

/** Result returned by the screenshot API factory. */
export interface CreatedApp {
    /** Configured Hono application. */
    app: Hono;
    /** Effective screenshot rate-limit configuration. */
    rateLimit: RateLimitConfig;
    /** Structured application logger. */
    logger: ReturnType<typeof createLogger>;
}

const DEFAULT_DEPENDENCIES: AppDependencies = {
    captureScreenshotsFn: captureScreenshots,
    createRequestId: () => crypto.randomUUID(),
};

/**
 * Creates the standalone screenshot API.
 *
 * @param options - Dependency and capacity overrides.
 * @returns Configured application and runtime metadata.
 */
export function createApp(options: CreateAppOptions = {}): CreatedApp {
    const dependencies: AppDependencies = {
        ...DEFAULT_DEPENDENCIES,
        ...options.dependencies,
    };
    const rateLimit: RateLimitConfig = {
        maxInFlight: resolvePositiveIntOption(
            options.maxInFlight,
            parsePositiveInt(process.env.MAX_INFLIGHT, DEFAULT_MAX_IN_FLIGHT),
        ),
        maxQueue: resolvePositiveIntOption(
            options.maxQueue,
            parsePositiveInt(process.env.MAX_QUEUE, DEFAULT_MAX_QUEUE),
        ),
        retryAfterSeconds: resolvePositiveIntOption(
            options.retryAfterSeconds,
            parsePositiveInt(
                process.env.RATE_LIMIT_RETRY_AFTER_SECS,
                DEFAULT_RETRY_AFTER_SECONDS,
            ),
        ),
    };
    const scheduler = createTaskScheduler(
        rateLimit.maxInFlight,
        rateLimit.maxQueue,
    );
    const logger = createLogger('api');
    const metrics = createMetrics();
    const app = new Hono();

    app.get('/', (context) =>
        context.json({ ok: true, message: 'Screenshot service ready' }),
    );
    app.get('/health', (context) => context.json({ ok: true }));
    app.post('/screenshots', async (context) => {
        const requestId = resolveRequestId(
            context.req.header('x-request-id'),
            dependencies.createRequestId,
        );
        metrics.increment('screenshot.request.received');
        logger.info('screenshot.request.received', { requestId });

        let body: unknown;
        try {
            body = await context.req.json();
        } catch {
            metrics.increment('screenshot.request.invalid_json');
            logger.warn('screenshot.request.invalid_json', { requestId });
            return context.json(
                { ok: false, error: 'Invalid JSON body.' },
                400,
            );
        }

        const parsedBody = screenshotRequestSchema.safeParse(body);
        if (!parsedBody.success) {
            const details = parsedBody.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            }));
            metrics.increment('screenshot.request.validation_failed');
            logger.warn('screenshot.request.validation_failed', {
                requestId,
                issues: details,
            });
            return context.json(
                { ok: false, error: 'Invalid request body.', details },
                400,
            );
        }

        const normalizedUrl = new URL(parsedBody.data.url).toString();
        const includeMobile = parsedBody.data.includeMobile ?? false;
        const finishTimer = metrics.time('screenshot.request.durationMs');
        const schedulerState = scheduler.getState();
        metrics.gauge('screenshot.in_flight', schedulerState.inFlight);
        metrics.gauge('screenshot.queue_depth', schedulerState.queueDepth);

        try {
            const screenshotOptions: ScreenshotOptions = {
                url: normalizedUrl,
                includeMobile,
                ...(parsedBody.data.waitForMs === undefined
                    ? {}
                    : { waitForMs: parsedBody.data.waitForMs }),
                ...(parsedBody.data.resizeWaitMs === undefined
                    ? {}
                    : { resizeWaitMs: parsedBody.data.resizeWaitMs }),
            };
            const queued = scheduler.scheduleTask(() =>
                dependencies.captureScreenshotsFn(screenshotOptions),
            );
            if (!queued.accepted || !queued.promise) {
                const currentState = scheduler.getState();
                metrics.increment('screenshot.request.rate_limited');
                logger.warn('screenshot.request.rate_limited', {
                    requestId,
                    ...currentState,
                });
                return context.json(
                    {
                        ok: false,
                        error: 'Too many requests. Try again later.',
                        inFlight: currentState.inFlight,
                        queueDepth: currentState.queueDepth,
                    },
                    429,
                    { 'Retry-After': rateLimit.retryAfterSeconds.toString() },
                );
            }

            const result = await queued.promise;
            const durationMs = finishTimer();
            metrics.increment('screenshot.request.completed');
            logger.info('screenshot.request.completed', {
                requestId,
                durationMs,
                includeMobile,
            });
            return context.json({
                ok: true,
                url: normalizedUrl,
                desktop: { base64: result.desktop.base64 },
                ...(result.mobile
                    ? { mobile: { base64: result.mobile.base64 } }
                    : {}),
            });
        } catch (error) {
            const durationMs = finishTimer();
            const message =
                error instanceof Error ? error.message : 'Unexpected error.';
            metrics.increment('screenshot.request.failed');
            logger.error('screenshot.request.failed', {
                requestId,
                durationMs,
                error: message,
            });
            return context.json({ ok: false, error: message }, 500);
        }
    });

    return { app, rateLimit, logger };
}
