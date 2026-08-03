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
                    const goto = vi.fn().mockResolvedValue(undefined);
                    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
                    const evaluate = vi.fn().mockResolvedValue(undefined);
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
});
