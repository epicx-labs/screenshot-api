import crypto from 'node:crypto';
import { Configuration, MemoryStorage, PlaywrightCrawler } from 'crawlee';
import type { Page } from 'playwright';

import { createLogger } from '../../utils/logger.js';
import { prepareCleanScreenshot } from './clean-screenshot.js';

const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DEFAULT_WAIT_FOR_MS = 1000;
const DEFAULT_RESIZE_WAIT_MS = 500;
const DEFAULT_JOB_TIMEOUT_MS = 120000;

export type ScreenshotResult = {
    desktop: { base64: string };
    mobile?: { base64: string };
};

export type ScreenshotOptions = {
    url: string;
    waitForMs?: number;
    resizeWaitMs?: number;
    timeoutMs?: number;
    includeMobile?: boolean;
};

type JobUserData = {
    jobId: string;
    waitForMs: number;
    resizeWaitMs: number;
    includeMobile: boolean;
};

type PendingJob = {
    resolve: (value: ScreenshotResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
};

/**
 * Parameters for capturing a screenshot after switching to a target viewport.
 */
interface ViewportCaptureOptions {
    /** Playwright page for the active crawl request. */
    page: Pick<
        Page,
        | 'setViewportSize'
        | 'reload'
        | 'waitForTimeout'
        | 'screenshot'
        | 'evaluate'
        | 'frames'
        | 'mainFrame'
    >;
    /** URL being captured. */
    url: string;
    /** Final viewport to capture. */
    viewport: {
        width: number;
        height: number;
    };
    /** Whether the page should be reloaded after the viewport change. */
    reloadAfterResize: boolean;
    /** Extra wait after a reload-driven navigation settles. */
    waitForMs: number;
    /** Extra wait used during lazy media preparation. */
    resizeWaitMs: number;
}

const pendingJobs = new Map<string, PendingJob>();
let crawler: PlaywrightCrawler | null = null;
let crawlerRunPromise: Promise<void> | null = null;
const logger = createLogger('screenshots');

/**
 * Captures desktop and optional mobile screenshots for a URL.
 *
 * @param options - Screenshot request configuration.
 * @returns Base64-encoded screenshot payloads.
 */
export async function captureScreenshots(
    options: ScreenshotOptions,
): Promise<ScreenshotResult> {
    const waitForMs =
        typeof options.waitForMs === 'number'
            ? options.waitForMs
            : DEFAULT_WAIT_FOR_MS;
    const resizeWaitMs =
        typeof options.resizeWaitMs === 'number'
            ? options.resizeWaitMs
            : DEFAULT_RESIZE_WAIT_MS;
    const includeMobile = options.includeMobile === true;

    const jobId = crypto.randomUUID();
    const timeoutMs =
        typeof options.timeoutMs === 'number'
            ? options.timeoutMs
            : DEFAULT_JOB_TIMEOUT_MS;

    logger.info('screenshot.job.queued', {
        jobId,
        url: options.url,
        includeMobile,
        waitForMs,
        resizeWaitMs,
        timeoutMs,
    });

    const crawlerInstance = await ensureCrawler();

    const resultPromise = new Promise<ScreenshotResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingJobs.delete(jobId);
            logger.warn('screenshot.job.timeout', { jobId, url: options.url });
            reject(new Error('Screenshot capture timed out.'));
        }, timeoutMs);

        pendingJobs.set(jobId, { resolve, reject, timeout });
    });

    await crawlerInstance.addRequests([
        {
            url: options.url,
            // Use a per-job unique key so the same URL can be captured repeatedly.
            uniqueKey: `screenshot:${jobId}`,
            userData: {
                jobId,
                waitForMs,
                resizeWaitMs,
                includeMobile,
            } satisfies JobUserData,
        },
    ]);
    await ensureCrawlerRun();

    return resultPromise;
}

/**
 * Captures a screenshot after switching the page to a target viewport.
 *
 * Some sites compute desktop layout only on initial load. The caller can opt
 * into a post-resize reload when needed, while keeping other captures on the
 * same loaded document.
 *
 * @param options - Viewport capture parameters.
 * @returns Screenshot buffer for the requested viewport.
 */
async function captureViewportScreenshot(
    options: ViewportCaptureOptions,
): Promise<Buffer> {
    const { page, url, viewport, reloadAfterResize, waitForMs, resizeWaitMs } =
        options;

    await page.setViewportSize(viewport);

    if (reloadAfterResize) {
        await page.reload({
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });
    }

    if (waitForMs > 0) {
        await page.waitForTimeout(waitForMs);
    }

    await prepareCleanScreenshot({
        page,
        lazyLoadWaitMs: resizeWaitMs,
        onWarning: (phase, error) => {
            logger.warn('screenshot.clean.warning', {
                url,
                phase,
                error,
            });
        },
    });

    logger.info('screenshot.viewport.capture', {
        url,
        viewport,
    });

    return page.screenshot({
        fullPage: false,
    });
}

async function ensureCrawler(): Promise<PlaywrightCrawler> {
    if (!crawler) {
        const storageClient = new MemoryStorage({ persistStorage: false });
        const config = new Configuration({
            persistStorage: false,
            storageClient,
        });
        logger.info('screenshot.crawler.initializing');
        crawler = new PlaywrightCrawler(
            {
                maxConcurrency: 1,
                requestHandlerTimeoutSecs: 120,
                maxRequestRetries: 1,
                keepAlive: true,
                async requestHandler({ page, request, log }) {
                    const userData = request.userData as
                        | Partial<JobUserData>
                        | undefined;
                    const jobId = userData?.jobId;
                    if (!jobId) {
                        log.warning('Missing jobId on request, skipping.');
                        return;
                    }

                    const job = pendingJobs.get(jobId);
                    if (!job) {
                        log.warning('No pending job for request, skipping.', {
                            jobId,
                        });
                        return;
                    }

                    try {
                        log.info('Capturing screenshots', { url: request.url });

                        await page
                            .waitForLoadState('domcontentloaded', {
                                timeout: 30000,
                            })
                            .catch((error: unknown) => {
                                log.warning(
                                    'Load state timeout, continuing anyway.',
                                    {
                                        url: request.url,
                                        error:
                                            error instanceof Error
                                                ? error.message
                                                : String(error),
                                    },
                                );
                            });

                        const waitForMs =
                            typeof userData?.waitForMs === 'number'
                                ? userData.waitForMs
                                : DEFAULT_WAIT_FOR_MS;
                        const resizeWaitMs =
                            typeof userData?.resizeWaitMs === 'number'
                                ? userData.resizeWaitMs
                                : DEFAULT_RESIZE_WAIT_MS;
                        const includeMobile = userData?.includeMobile === true;

                        const desktopBuffer = await captureViewportScreenshot({
                            page,
                            url: request.url,
                            viewport: DESKTOP_VIEWPORT,
                            reloadAfterResize: true,
                            waitForMs,
                            resizeWaitMs,
                        });

                        let mobileBase64: string | undefined;
                        if (includeMobile) {
                            const mobileBuffer =
                                await captureViewportScreenshot({
                                    page,
                                    url: request.url,
                                    viewport: MOBILE_VIEWPORT,
                                    reloadAfterResize: false,
                                    waitForMs: 0,
                                    resizeWaitMs,
                                });
                            mobileBase64 = mobileBuffer.toString('base64');
                        }
                        job.resolve({
                            desktop: {
                                base64: desktopBuffer.toString('base64'),
                            },
                            ...(mobileBase64
                                ? { mobile: { base64: mobileBase64 } }
                                : {}),
                        });

                        clearTimeout(job.timeout);
                        pendingJobs.delete(jobId);
                        logger.info('screenshot.job.completed', {
                            jobId,
                            url: request.url,
                            includeMobile,
                        });
                    } catch (error) {
                        const message =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        log.error(
                            'Screenshot request failed, will retry if possible.',
                            {
                                url: request.url,
                                jobId,
                                error: message,
                            },
                        );
                        logger.error('screenshot.job.error', {
                            jobId,
                            url: request.url,
                            error: message,
                        });
                        throw error;
                    }
                },
                async failedRequestHandler({ request, log }) {
                    const userData = request.userData as
                        | Partial<JobUserData>
                        | undefined;
                    const jobId = userData?.jobId;
                    if (!jobId) {
                        return;
                    }
                    const job = pendingJobs.get(jobId);
                    if (!job) {
                        return;
                    }
                    log.error('Screenshot job failed after retries.', {
                        jobId,
                        url: request.url,
                    });
                    logger.error('screenshot.job.failed', {
                        jobId,
                        url: request.url,
                    });
                    clearTimeout(job.timeout);
                    pendingJobs.delete(jobId);
                    job.reject(
                        new Error('Screenshot capture failed after retries.'),
                    );
                },
            },
            config,
        );
    }

    return crawler;
}

async function ensureCrawlerRun(): Promise<void> {
    if (!crawler) {
        return;
    }
    if (!crawlerRunPromise) {
        logger.info('screenshot.crawler.run_start');
        crawlerRunPromise = crawler
            .run()
            .then(() => undefined)
            .catch((error) => {
                console.error('Crawler run failed:', error);
            })
            .finally(() => {
                crawlerRunPromise = null;
            });
    }
}
