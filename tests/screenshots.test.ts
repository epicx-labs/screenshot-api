import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type MockRequestRecord = {
    url: string;
    uniqueKey: string;
    userData: {
        jobId: string;
        waitForMs: number;
        resizeWaitMs: number;
        includeMobile: boolean;
    };
};

type MockCrawlerOptions = {
    requestHandler: (context: {
        page: {
            waitForLoadState: (
                state: string,
                options: { timeout: number },
            ) => Promise<void>;
            waitForTimeout: (ms: number) => Promise<void>;
            setViewportSize: (viewport: {
                width: number;
                height: number;
            }) => Promise<void>;
            reload: (options: {
                waitUntil: string;
                timeout: number;
            }) => Promise<void>;
            screenshot: (options: { fullPage: boolean }) => Promise<Buffer>;
            evaluate: (
                callback: (...args: readonly unknown[]) => unknown,
                ...args: readonly unknown[]
            ) => Promise<unknown>;
        };
        request: {
            url: string;
            userData?: unknown;
        };
        log: {
            info: (message: string, data?: unknown) => void;
            warning: (message: string, data?: unknown) => void;
            error: (message: string, data?: unknown) => void;
        };
    }) => Promise<void>;
    failedRequestHandler?: (context: {
        request: {
            url: string;
            userData?: unknown;
        };
        log: {
            info: (message: string, data?: unknown) => void;
            warning: (message: string, data?: unknown) => void;
            error: (message: string, data?: unknown) => void;
        };
    }) => Promise<void>;
};

type MockCrawlerInstance = {
    options: MockCrawlerOptions;
    queue: MockRequestRecord[];
    addedRequests: MockRequestRecord[];
    pageRecords: Array<{
        waitForTimeout: ReturnType<typeof vi.fn>;
        reload: ReturnType<typeof vi.fn>;
        evaluate: ReturnType<typeof vi.fn>;
        screenshot: ReturnType<typeof vi.fn>;
    }>;
    runCalls: number;
    addRequests: (requests: MockRequestRecord[]) => Promise<void>;
    run: () => Promise<void>;
};

type MockCrawleeState = {
    instances: MockCrawlerInstance[];
    runMode: 'success' | 'idle' | 'failed_handler';
    screenshotMode: 'sequential' | 'desktop_reload_required';
    requiresCleanPreparation: boolean;
    evaluateMode: 'success' | 'throw';
    screenshotBuffers: Buffer[];
    staleScreenshotBuffer: Buffer;
};

const crawleeMockState = vi.hoisted(
    (): MockCrawleeState => ({
        instances: [],
        runMode: 'success',
        screenshotMode: 'sequential',
        requiresCleanPreparation: false,
        evaluateMode: 'success',
        screenshotBuffers: [Buffer.from('desktop'), Buffer.from('mobile')],
        staleScreenshotBuffer: Buffer.from('stale-layout'),
    }),
);

/**
 * Returns the first mock crawler instance created by the test.
 *
 * @returns First mock crawler instance.
 */
function getFirstCrawlerInstance(): MockCrawlerInstance {
    const instance = crawleeMockState.instances[0];
    expect(instance).toBeDefined();
    if (instance === undefined) {
        throw new Error('Expected a mock crawler instance.');
    }
    return instance;
}

/**
 * Returns the first request added to a mock crawler instance.
 *
 * @param instance - Mock crawler instance to inspect.
 * @returns First added request.
 */
function getFirstAddedRequest(
    instance: MockCrawlerInstance,
): MockRequestRecord {
    const request = instance.addedRequests[0];
    expect(request).toBeDefined();
    if (request === undefined) {
        throw new Error('Expected a mock crawler request.');
    }
    return request;
}

/**
 * Returns the first page record created by a mock crawler instance.
 *
 * @param instance - Mock crawler instance to inspect.
 * @returns First page record.
 */
function getFirstPageRecord(
    instance: MockCrawlerInstance,
): MockCrawlerInstance['pageRecords'][number] {
    const pageRecord = instance.pageRecords[0];
    expect(pageRecord).toBeDefined();
    if (pageRecord === undefined) {
        throw new Error('Expected a mock page record.');
    }
    return pageRecord;
}

/**
 * Returns the first invocation order for a Vitest mock.
 *
 * @param mock - Mock function to inspect.
 * @returns First invocation order.
 */
function getFirstInvocationOrder(mock: ReturnType<typeof vi.fn>): number {
    const order = mock.mock.invocationCallOrder[0];
    expect(order).toBeDefined();
    if (order === undefined) {
        throw new Error('Expected a mock invocation order.');
    }
    return order;
}

vi.mock('crawlee', () => {
    class MockMemoryStorage {}

    class MockConfiguration {}

    class MockPlaywrightCrawler implements MockCrawlerInstance {
        options: MockCrawlerOptions;
        queue: MockRequestRecord[] = [];
        addedRequests: MockRequestRecord[] = [];
        pageRecords: MockCrawlerInstance['pageRecords'] = [];
        runCalls = 0;

        constructor(options: MockCrawlerOptions) {
            this.options = options;
            crawleeMockState.instances.push(this);
        }

        async addRequests(requests: MockRequestRecord[]): Promise<void> {
            this.addedRequests.push(...requests);
            this.queue.push(...requests);
        }

        async run(): Promise<void> {
            this.runCalls += 1;

            if (crawleeMockState.runMode === 'idle') {
                return new Promise<void>(() => undefined);
            }

            const pending = [...this.queue];
            this.queue = [];

            for (const request of pending) {
                const log = {
                    info: vi.fn(),
                    warning: vi.fn(),
                    error: vi.fn(),
                };

                if (crawleeMockState.runMode === 'failed_handler') {
                    if (this.options.failedRequestHandler) {
                        await this.options.failedRequestHandler({
                            request,
                            log,
                        });
                    }
                    continue;
                }

                let screenshotCall = 0;
                let cleanPreparationCount = 0;
                let viewportVersion = 0;
                let reloadedViewportVersion = -1;
                const waitForTimeout = vi.fn().mockResolvedValue(undefined);
                const reload = vi.fn().mockImplementation(async () => {
                    reloadedViewportVersion = viewportVersion;
                });
                const evaluate = vi.fn().mockImplementation(async () => {
                    if (crawleeMockState.evaluateMode === 'throw') {
                        throw new Error('cleanup failed');
                    }
                    cleanPreparationCount += 1;
                });
                const screenshot = vi.fn().mockImplementation(async () => {
                    if (
                        crawleeMockState.requiresCleanPreparation &&
                        cleanPreparationCount <= screenshotCall
                    ) {
                        const buffer = Buffer.from(`dirty-${screenshotCall}`);
                        screenshotCall += 1;
                        return buffer;
                    }

                    if (
                        crawleeMockState.screenshotMode ===
                            'desktop_reload_required' &&
                        screenshotCall === 0 &&
                        reloadedViewportVersion !== viewportVersion
                    ) {
                        return crawleeMockState.staleScreenshotBuffer;
                    }

                    const buffer =
                        crawleeMockState.screenshotBuffers[screenshotCall] ??
                        crawleeMockState.screenshotBuffers[0];
                    screenshotCall += 1;
                    return buffer;
                });
                const page = {
                    waitForLoadState: vi.fn().mockResolvedValue(undefined),
                    waitForTimeout,
                    setViewportSize: vi.fn().mockImplementation(async () => {
                        viewportVersion += 1;
                    }),
                    reload,
                    screenshot,
                    evaluate,
                };
                this.pageRecords.push({
                    waitForTimeout,
                    reload,
                    evaluate,
                    screenshot,
                });

                try {
                    await this.options.requestHandler({
                        page,
                        request,
                        log,
                    });
                } catch {
                    if (this.options.failedRequestHandler) {
                        await this.options.failedRequestHandler({
                            request,
                            log,
                        });
                    }
                }
            }
        }
    }

    return {
        Configuration: MockConfiguration,
        MemoryStorage: MockMemoryStorage,
        PlaywrightCrawler: MockPlaywrightCrawler,
    };
});

/**
 * Encodes text to base64 for stable screenshot assertions.
 *
 * @param value - Plain text payload.
 * @returns Base64-encoded text.
 */
function toBase64(value: string): string {
    return Buffer.from(value).toString('base64');
}

/**
 * Imports the screenshots module with a fresh module cache.
 *
 * @returns Screenshot module exports.
 */
async function importScreenshotsModule(): Promise<
    typeof import('../src/modules/screenshots/index.js')
> {
    return import('../src/modules/screenshots/index.js');
}

describe.sequential('screenshots module', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useRealTimers();
        crawleeMockState.instances = [];
        crawleeMockState.runMode = 'success';
        crawleeMockState.screenshotMode = 'sequential';
        crawleeMockState.requiresCleanPreparation = false;
        crawleeMockState.evaluateMode = 'success';
        crawleeMockState.screenshotBuffers = [
            Buffer.from('desktop'),
            Buffer.from('mobile'),
        ];
        crawleeMockState.staleScreenshotBuffer = Buffer.from('stale-layout');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('returns desktop screenshot and applies default request options', async () => {
        const { captureScreenshots } = await importScreenshotsModule();
        const result = await captureScreenshots({
            url: 'https://example.com',
        });

        expect(result.desktop.base64).toBe(toBase64('desktop'));
        expect(result.mobile).toBeUndefined();
        expect(crawleeMockState.instances).toHaveLength(1);

        const firstInstance = getFirstCrawlerInstance();
        const firstRequest = getFirstAddedRequest(firstInstance);
        expect(firstRequest.url).toBe('https://example.com');
        expect(firstRequest.uniqueKey.startsWith('screenshot:')).toBe(true);
        expect(firstRequest.userData.waitForMs).toBe(1000);
        expect(firstRequest.userData.resizeWaitMs).toBe(500);
        expect(firstRequest.userData.includeMobile).toBe(false);
    });

    test('returns desktop and mobile screenshots when mobile capture is enabled', async () => {
        crawleeMockState.screenshotBuffers = [
            Buffer.from('desktop-custom'),
            Buffer.from('mobile-custom'),
        ];

        const { captureScreenshots } = await importScreenshotsModule();
        const result = await captureScreenshots({
            url: 'https://example.com/mobile',
            waitForMs: 250,
            resizeWaitMs: 125,
            includeMobile: true,
        });

        expect(result.desktop.base64).toBe(toBase64('desktop-custom'));
        expect(result.mobile?.base64).toBe(toBase64('mobile-custom'));

        const firstInstance = getFirstCrawlerInstance();
        const firstRequest = getFirstAddedRequest(firstInstance);
        expect(firstRequest.userData.waitForMs).toBe(250);
        expect(firstRequest.userData.resizeWaitMs).toBe(125);
        expect(firstRequest.userData.includeMobile).toBe(true);
    });

    test('reloads after the desktop viewport change before capturing screenshots', async () => {
        crawleeMockState.screenshotMode = 'desktop_reload_required';
        crawleeMockState.screenshotBuffers = [
            Buffer.from('desktop-reloaded'),
            Buffer.from('mobile-reloaded'),
        ];
        crawleeMockState.staleScreenshotBuffer = Buffer.from('stale-layout');

        const { captureScreenshots } = await importScreenshotsModule();
        const result = await captureScreenshots({
            url: 'https://example.com/reload-required',
            includeMobile: true,
        });

        expect(result.desktop.base64).toBe(toBase64('desktop-reloaded'));
        expect(result.mobile?.base64).toBe(toBase64('mobile-reloaded'));
    });

    test('prepares each viewport as a clean screenshot before capture', async () => {
        crawleeMockState.requiresCleanPreparation = true;

        const { captureScreenshots } = await importScreenshotsModule();
        const result = await captureScreenshots({
            url: 'https://example.com/clean',
            includeMobile: true,
        });

        expect(result.desktop.base64).toBe(toBase64('desktop'));
        expect(result.mobile?.base64).toBe(toBase64('mobile'));

        const firstInstance = getFirstCrawlerInstance();
        const firstPage = getFirstPageRecord(firstInstance);

        expect(firstPage.evaluate).toHaveBeenCalled();
        expect(getFirstInvocationOrder(firstPage.evaluate)).toBeLessThan(
            getFirstInvocationOrder(firstPage.screenshot),
        );
    });

    test('returns screenshot when clean preparation scripts fail', async () => {
        crawleeMockState.evaluateMode = 'throw';

        const { captureScreenshots } = await importScreenshotsModule();
        const result = await captureScreenshots({
            url: 'https://example.com/best-effort-clean',
        });

        expect(result.desktop.base64).toBe(toBase64('desktop'));

        const firstInstance = getFirstCrawlerInstance();
        const firstPage = getFirstPageRecord(firstInstance);
        expect(firstPage.evaluate).toHaveBeenCalled();
    });

    test('applies page settle delay once and reloads only for desktop capture', async () => {
        const { captureScreenshots } = await importScreenshotsModule();
        await captureScreenshots({
            url: 'https://example.com/timing',
            includeMobile: true,
            waitForMs: 250,
            resizeWaitMs: 125,
        });

        const firstInstance = getFirstCrawlerInstance();
        const firstPage = getFirstPageRecord(firstInstance);

        expect(firstPage.waitForTimeout.mock.calls).toEqual([
            [250],
            [125],
            [125],
        ]);
        expect(firstPage.reload).toHaveBeenCalledTimes(1);
        expect(getFirstInvocationOrder(firstPage.reload)).toBeLessThan(
            getFirstInvocationOrder(firstPage.waitForTimeout),
        );
    });

    test('rejects with timeout error when crawler never processes queued request', async () => {
        vi.useFakeTimers();
        crawleeMockState.runMode = 'idle';

        const { captureScreenshots } = await importScreenshotsModule();
        const promise = captureScreenshots({
            url: 'https://example.com/slow',
            timeoutMs: 10,
        });
        const assertion = expect(promise).rejects.toThrow(
            'Screenshot capture timed out.',
        );

        await vi.advanceTimersByTimeAsync(20);
        await assertion;
    });

    test('rejects with failed-after-retries error when failed handler executes', async () => {
        crawleeMockState.runMode = 'failed_handler';

        const { captureScreenshots } = await importScreenshotsModule();
        await expect(
            captureScreenshots({ url: 'https://example.com/fail' }),
        ).rejects.toThrow('Screenshot capture failed after retries.');
    });
});
