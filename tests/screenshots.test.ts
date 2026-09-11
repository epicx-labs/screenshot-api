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
    navigationStatus: 200,
    renderedState: {
        bodyText: 'Example product documentation',
        hasChallengeElement: false,
        heading: 'Documentation',
        title: 'Example',
        visibleMediaCount: 0,
        visibleTextLength: 29,
    },
}));

vi.mock('playwright', () => ({
    chromium: {
        launch: vi.fn(async () => ({
            newContext: vi.fn(
                async ({
                    viewport,
                }: {
                    viewport: { width: number; height: number };
                }) => {
                    const screenshotIndex = playwrightState.contexts.length;
                    const goto = vi.fn().mockImplementation(async () => ({
                        status: () => playwrightState.navigationStatus,
                    }));
                    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
                    const evaluate = vi
                        .fn()
                        .mockImplementation(async (script: unknown) =>
                            typeof script === 'string' &&
                            script.includes('__SCREENSHOT_VALIDATION__')
                                ? playwrightState.renderedState
                                : undefined,
                        );
                    const screenshot = vi.fn().mockImplementation(async () => {
                        if (playwrightState.screenshotError) {
                            throw playwrightState.screenshotError;
                        }
                        return (
                            playwrightState.screenshotBuffers[
                                screenshotIndex
                            ] ?? Buffer.from('desktop')
                        );
                    });
                    const close = vi.fn().mockResolvedValue(undefined);
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
                            url: () => 'https://example.com/',
                            waitForTimeout,
                            evaluate,
                            screenshot,
                        })),
                        close,
                    };
                },
            ),
        })),
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
        playwrightState.navigationStatus = 200;
        playwrightState.renderedState = {
            bodyText: 'Example product documentation',
            hasChallengeElement: false,
            heading: 'Documentation',
            title: 'Example',
            visibleMediaCount: 0,
            visibleTextLength: 29,
        };
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

    test('rejects an HTTP error page before capturing pixels', async () => {
        playwrightState.navigationStatus = 404;
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );

        await expect(
            captureScreenshots({ url: 'https://example.com/missing' }),
        ).rejects.toThrow('HTTP 404');
        expect(playwrightState.contexts[0]?.screenshot).not.toHaveBeenCalled();
    });

    test.each([
        {
            name: 'CAPTCHA challenge',
            state: {
                bodyText: 'Verify you are human',
                hasChallengeElement: true,
                heading: '',
                title: 'Attention required',
                visibleMediaCount: 0,
                visibleTextLength: 20,
            },
        },
        {
            name: 'loading shell',
            state: {
                bodyText: 'Loading...',
                hasChallengeElement: false,
                heading: '',
                title: '',
                visibleMediaCount: 0,
                visibleTextLength: 10,
            },
        },
        {
            name: 'blank viewport',
            state: {
                bodyText: '',
                hasChallengeElement: false,
                heading: '',
                title: '',
                visibleMediaCount: 0,
                visibleTextLength: 0,
            },
        },
    ])('rejects a $name before capturing pixels', async ({ state }) => {
        playwrightState.renderedState = state;
        const { captureScreenshots } = await import(
            '../src/modules/screenshots/index.js'
        );

        await expect(
            captureScreenshots({ url: 'https://example.com' }),
        ).rejects.toThrow('not a valid rendered page');
        expect(playwrightState.contexts[0]?.screenshot).not.toHaveBeenCalled();
    });
});
