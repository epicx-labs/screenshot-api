import {
    type Browser,
    type BrowserServer,
    chromium,
    type ViewportSize,
} from 'playwright';

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
    /** Deadline for the entire capture, including both viewports and cleanup. */
    timeoutMs?: number;
    /** Cancels running work when the HTTP client disconnects. */
    signal?: AbortSignal;
    /** Whether to include a mobile screenshot. */
    includeMobile?: boolean;
}

/** Options for one viewport capture. */
interface ViewportCaptureOptions {
    /** Browser owned by this screenshot request. */
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
    /** Records the current operation for failure diagnostics. */
    setStage: (stage: string) => void;
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
    options.setStage('create context');
    const context = await options.browser.newContext({
        viewport: options.viewport,
    });

    try {
        options.setStage('create page');
        const page = await context.newPage();
        options.setStage('navigate');
        await page.goto(options.url, {
            waitUntil: 'domcontentloaded',
            timeout: options.timeoutMs,
        });

        if (options.waitForMs > 0) {
            options.setStage('wait after navigation');
            await page.waitForTimeout(options.waitForMs);
        }

        options.setStage('clean page');
        await prepareCleanScreenshot({
            page,
            lazyLoadWaitMs: options.resizeWaitMs,
            onWarning: (phase, error) => {
                console.warn(`Clean screenshot phase failed: ${phase}`, error);
            },
        });

        options.setStage('screenshot');
        const buffer = await page.screenshot({
            type: 'png',
            fullPage: false,
            timeout: options.timeoutMs,
        });
        return { base64: buffer.toString('base64') };
    } finally {
        options.setStage('close context');
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
    options.signal?.throwIfAborted();
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
        ? AbortSignal.any([deadline, options.signal])
        : deadline;
    let server: BrowserServer | undefined;
    let launching: Promise<BrowserServer> | undefined;
    let stage = 'launch browser';
    let viewport = 'desktop';
    const executablePath =
        process.env.PLAYWRIGHT_EXECUTABLE_PATH ??
        process.env.CRAWLEE_DEFAULT_BROWSER_PATH;
    let rejectCancellation: (reason: Error) => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
        rejectCancellation = reject;
    });
    const onAbort = () =>
        rejectCancellation(
            new Error(
                deadline.aborted
                    ? `Capture timed out after ${timeoutMs}ms.`
                    : 'Capture cancelled.',
            ),
        );
    signal.addEventListener('abort', onAbort, { once: true });

    /** Runs one capture in its own process so cancellation cannot affect other jobs. */
    const run = async (): Promise<ScreenshotResult> => {
        launching = chromium.launchServer({
            headless: true,
            timeout: timeoutMs,
            ...(executablePath ? { executablePath } : {}),
        });
        server = await launching;
        // A client can disconnect while launch is pending. Dispose the late process.
        signal.throwIfAborted();
        stage = 'connect browser';
        const browser = await chromium.connect(server.wsEndpoint(), {
            timeout: timeoutMs,
        });
        signal.throwIfAborted();
        const captureOptions = {
            browser,
            url: options.url,
            waitForMs: options.waitForMs ?? DEFAULT_WAIT_FOR_MS,
            resizeWaitMs: options.resizeWaitMs ?? DEFAULT_RESIZE_WAIT_MS,
            timeoutMs,
            setStage: (value: string) => {
                stage = value;
            },
        };
        const desktop = await captureViewport({
            ...captureOptions,
            viewport: DESKTOP_VIEWPORT,
        });

        if (!options.includeMobile) {
            stage = 'close browser';
            await server.close();
            return { desktop };
        }

        viewport = 'mobile';
        const mobile = await captureViewport({
            ...captureOptions,
            viewport: MOBILE_VIEWPORT,
        });
        stage = 'close browser';
        await server.close();
        return { desktop, mobile };
    };

    try {
        return await Promise.race([run(), cancelled]);
    } catch (error) {
        console.warn('Screenshot capture failed', {
            hostname: new URL(options.url).hostname,
            viewport,
            stage,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        });
        // kill() waits for process exit; release queue capacity only after work stops.
        // Launch has its own bounded timeout. Wait for a late process before
        // releasing capacity, including when the client disconnects at startup.
        const ownedServer = server ?? (await launching?.catch(() => undefined));
        await ownedServer?.kill();
        throw error;
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}
