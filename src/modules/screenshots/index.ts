import { type Browser, chromium, type ViewportSize } from 'playwright';

import { prepareCleanScreenshot } from './clean-screenshot.js';

const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DEFAULT_WAIT_FOR_MS = 1000;
const DEFAULT_RESIZE_WAIT_MS = 500;
const DEFAULT_TIMEOUT_MS = 120000;

/** Base64-encoded screenshot image. */
export interface ScreenshotImage {
    /** PNG image encoded as base64. */
    base64: string;
}

/** Screenshots returned for one URL. */
export interface ScreenshotResult {
    /** Required desktop screenshot. */
    desktop: ScreenshotImage;
    /** Optional mobile screenshot. */
    mobile?: ScreenshotImage;
}

/** Options for one screenshot request. */
export interface ScreenshotOptions {
    /** HTTP or HTTPS URL to capture. */
    url: string;
    /** Extra delay after navigation. */
    waitForMs?: number;
    /** Delay used while loading lazy media. */
    resizeWaitMs?: number;
    /** Navigation timeout. */
    timeoutMs?: number;
    /** Whether to include a mobile screenshot. */
    includeMobile?: boolean;
}

/** Options for one viewport capture. */
interface ViewportCaptureOptions {
    /** Browser shared by screenshot requests. */
    browser: Browser;
    /** URL to capture. */
    url: string;
    /** Browser viewport. */
    viewport: ViewportSize;
    /** Extra delay after navigation. */
    waitForMs: number;
    /** Delay used while loading lazy media. */
    resizeWaitMs: number;
    /** Navigation timeout. */
    timeoutMs: number;
}

let browserPromise: Promise<Browser> | undefined;

/**
 * Returns the shared headless browser, launching it when first needed.
 *
 * @returns Playwright browser instance.
 */
async function getBrowser(): Promise<Browser> {
    if (!browserPromise) {
        const executablePath =
            process.env.PLAYWRIGHT_EXECUTABLE_PATH ??
            process.env.CRAWLEE_DEFAULT_BROWSER_PATH;

        browserPromise = chromium
            .launch({
                headless: true,
                ...(executablePath ? { executablePath } : {}),
            })
            .catch((error: unknown) => {
                browserPromise = undefined;
                throw error;
            });
    }

    return browserPromise;
}

/**
 * Captures one independently loaded and cleaned viewport.
 *
 * @param options - Viewport capture options.
 * @returns Base64-encoded PNG screenshot.
 */
async function captureViewport(
    options: ViewportCaptureOptions,
): Promise<ScreenshotImage> {
    const context = await options.browser.newContext({
        viewport: options.viewport,
    });

    try {
        const page = await context.newPage();
        await page.goto(options.url, {
            waitUntil: 'domcontentloaded',
            timeout: options.timeoutMs,
        });

        if (options.waitForMs > 0) {
            await page.waitForTimeout(options.waitForMs);
        }

        await prepareCleanScreenshot({
            page,
            lazyLoadWaitMs: options.resizeWaitMs,
            onWarning: (phase, error) => {
                console.warn(`Clean screenshot phase failed: ${phase}`, error);
            },
        });

        const buffer = await page.screenshot({
            type: 'png',
            fullPage: false,
        });
        return { base64: buffer.toString('base64') };
    } finally {
        await context.close();
    }
}

/**
 * Captures a clean desktop screenshot and optional mobile screenshot.
 *
 * @param options - Screenshot request options.
 * @returns Captured screenshots.
 */
export async function captureScreenshots(
    options: ScreenshotOptions,
): Promise<ScreenshotResult> {
    const browser = await getBrowser();
    const captureOptions = {
        browser,
        url: options.url,
        waitForMs: options.waitForMs ?? DEFAULT_WAIT_FOR_MS,
        resizeWaitMs: options.resizeWaitMs ?? DEFAULT_RESIZE_WAIT_MS,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
    const desktop = await captureViewport({
        ...captureOptions,
        viewport: DESKTOP_VIEWPORT,
    });

    if (!options.includeMobile) {
        return { desktop };
    }

    const mobile = await captureViewport({
        ...captureOptions,
        viewport: MOBILE_VIEWPORT,
    });
    return { desktop, mobile };
}
