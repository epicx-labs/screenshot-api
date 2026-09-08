import { beforeEach, describe, expect, test, vi } from 'vitest';

const playwrightState = vi.hoisted(() => ({
    contexts: [] as Array<{
        viewport: { width: number; height: number };
        goto: ReturnType<typeof vi.fn>;
        waitForTimeout: ReturnType<typeof vi.fn>;
        evaluate: ReturnType<typeof vi.fn>;
        screenshot: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
    }>,
    screenshotBuffers: [Buffer.from('desktop'), Buffer.from('mobile')],
    screenshotError: undefined as Error | undefined,
    stallScreenshot: false,
    stalledOperation: '',
    launchGate: undefined as Promise<void> | undefined,
    kill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('playwright', () => ({
    chromium: {
        launchServer: vi.fn(async () => {
            await playwrightState.launchGate;
            return {
                wsEndpoint: () => 'ws://fixture',
                close: vi.fn().mockImplementation(async () => {
                    if (playwrightState.stalledOperation === 'close browser')
                        return new Promise(() => {});
                }),
                kill: playwrightState.kill,
            };
        }),
        connect: vi.fn(async () => {
            if (playwrightState.stalledOperation === 'connect browser')
                return new Promise(() => {});
            return {
                newContext: vi.fn(
                    async ({
                        viewport,
                    }: {
                        viewport: { width: number; height: number };
                    }) => {
                        const screenshotIndex = playwrightState.contexts.length;
                        const goto = vi.fn().mockResolvedValue(undefined);
                        const waitForTimeout = vi
                            .fn()
                            .mockResolvedValue(undefined);
                        const evaluate = vi
                            .fn()
                            .mockImplementation(async () => {
                                if (
                                    playwrightState.stalledOperation ===
                                    'cleanup'
                                )
                                    return new Promise(() => {});
                            });
                        const screenshot = vi
                            .fn()
                            .mockImplementation(async () => {
                                if (playwrightState.stallScreenshot) {
                                    return new Promise(() => {});
                                }
                                if (playwrightState.screenshotError) {
                                    throw playwrightState.screenshotError;
                                }
                                return (
                                    playwrightState.screenshotBuffers[
                                        screenshotIndex
                                    ] ?? Buffer.from('desktop')
                                );
                            });
                        const close = vi.fn().mockImplementation(async () => {
                            if (
                                playwrightState.stalledOperation ===
                                'close context'
                            )
                                return new Promise(() => {});
                        });
                        const context = {
                            viewport,
                            goto,
                            waitForTimeout,
                            evaluate,
                            screenshot,
                            close,
                        };
                        playwrightState.contexts.push(context);

                        return {
                            newPage: vi.fn(async () => ({
                                goto,
                                waitForTimeout,
                                evaluate,
                                screenshot,
                            })),
                            close,
                        };
                    },
                ),
            };
        }),
    },
}));

describe('captureScreenshots', () => {
    beforeEach(() => {
        vi.resetModules();
        playwrightState.contexts = [];
        playwrightState.screenshotBuffers = [
            Buffer.from('desktop'),
            Buffer.from('mobile'),
        ];
        playwrightState.screenshotError = undefined;
        playwrightState.stallScreenshot = false;
        playwrightState.stalledOperation = '';
        playwrightState.launchGate = undefined;
        playwrightState.kill.mockClear();
    });

    test('captures a cleaned desktop viewport with defaults', async () => {
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );
        const result = await captureScreenshots({
            url: 'https://example.com',
        });
        const context = playwrightState.contexts[0];

        expect(result).toEqual({
            desktop: { base64: Buffer.from('desktop').toString('base64') },
        });
        expect(context?.viewport).toEqual({ width: 1920, height: 1080 });
        expect(context?.goto).toHaveBeenCalledWith('https://example.com', {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
        });
        expect(context?.waitForTimeout).toHaveBeenCalledWith(1000);
        expect(context?.evaluate).toHaveBeenCalled();
        expect(context?.close).toHaveBeenCalledOnce();
    });

    test.each(['cleanup', 'close context', 'close browser', 'connect browser'])(
        'terminates a browser stalled during %s',
        async (operation) => {
            playwrightState.stalledOperation = operation;
            const { captureScreenshots } = await import(
                '../src/modules/screenshots/index.js'
            );
            await expect(
                captureScreenshots({
                    url: 'https://example.com',
                    timeoutMs: 30,
                }),
            ).rejects.toThrow('Capture timed out');
            expect(playwrightState.kill).toHaveBeenCalledOnce();
        },
    );

    test('kills a late browser after cancellation during launch', async () => {
        let finishLaunch = () => {};
        playwrightState.launchGate = new Promise<void>((resolve) => {
            finishLaunch = resolve;
        });
        const controller = new AbortController();
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );
        const capture = captureScreenshots({
            url: 'https://example.com',
            signal: controller.signal,
        });
        const assertion = expect(capture).rejects.toThrow('Capture cancelled');
        controller.abort();
        await Promise.resolve();
        expect(playwrightState.kill).not.toHaveBeenCalled();
        finishLaunch();
        await assertion;
        expect(playwrightState.kill).toHaveBeenCalledOnce();
        expect(playwrightState.contexts).toHaveLength(0);
    });

    test('terminates running work when its client cancels', async () => {
        playwrightState.stallScreenshot = true;
        const controller = new AbortController();
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );
        const capture = captureScreenshots({
            url: 'https://example.com',
            signal: controller.signal,
        });
        const assertion = expect(capture).rejects.toThrow('Capture cancelled');
        await vi.waitFor(
            () =>
                expect(
                    playwrightState.contexts[0]?.screenshot,
                ).toHaveBeenCalled(),
            { interval: 1 },
        );
        controller.abort();
        await assertion;
        expect(playwrightState.kill).toHaveBeenCalledOnce();
    });

    test('waits for browser termination before releasing the failed capture', async () => {
        playwrightState.stallScreenshot = true;
        let finishKill = () => {};
        playwrightState.kill.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishKill = resolve;
                }),
        );
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );
        let settled = false;
        const capture = captureScreenshots({
            url: 'https://example.com',
            timeoutMs: 30,
        }).catch(() => {
            settled = true;
        });
        await vi.waitFor(
            () => expect(playwrightState.kill).toHaveBeenCalledOnce(),
            { interval: 1 },
        );
        expect(settled).toBe(false);
        finishKill();
        await capture;
        expect(settled).toBe(true);
    });

    test('loads desktop and mobile viewports independently', async () => {
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );
        const result = await captureScreenshots({
            url: 'https://example.com',
            includeMobile: true,
            waitForMs: 0,
            resizeWaitMs: 0,
        });

        expect(result.mobile?.base64).toBe(
            Buffer.from('mobile').toString('base64'),
        );
        expect(
            playwrightState.contexts.map(({ viewport }) => viewport),
        ).toEqual([
            { width: 1920, height: 1080 },
            { width: 390, height: 844 },
        ]);
        expect(playwrightState.contexts[0]?.goto).toHaveBeenCalledOnce();
        expect(playwrightState.contexts[1]?.goto).toHaveBeenCalledOnce();
    });

    test('closes the browser context when capture fails', async () => {
        playwrightState.screenshotError = new Error('Screenshot failed.');
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );

        await expect(
            captureScreenshots({ url: 'https://example.com' }),
        ).rejects.toThrow('Screenshot failed.');
        expect(playwrightState.contexts[0]?.close).toHaveBeenCalledOnce();
    });

    test('a stalled capture times out and releases the HTTP queue', async () => {
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );
        const { createApp } = await import('../src/api/app.js');
        playwrightState.stallScreenshot = true;
        const app = createApp({
            maxInFlight: 1,
            captureScreenshotsFn: (options) =>
                captureScreenshots({ ...options, timeoutMs: 30 }),
        });
        const send = () =>
            app.request('/screenshots', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ url: 'https://example.com' }),
            });
        const first = send();
        await vi.waitFor(() =>
            expect(playwrightState.contexts[0]?.screenshot).toHaveBeenCalled(),
        );
        playwrightState.stallScreenshot = false;
        const second = send();
        expect((await first).status).toBe(500);
        expect(playwrightState.kill).toHaveBeenCalledOnce();
        expect((await second).status).toBe(200);
    }, 1000);
});
