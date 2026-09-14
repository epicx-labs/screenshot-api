import type { Page, Response as PlaywrightResponse } from 'playwright';

const INVALID_PAGE_TEXT =
    /^(?:(?:404(?: error)?|access denied|attention required|captcha|checking your browser|just a moment|not found|page not found|please wait|verify (?:that )?you are human)(?:\s*[-|:].*)?|loading(?:\.{0,3})?)$/i;
const CHALLENGE_PAGE_TEXT =
    /\b(?:attention required|checking your browser|just a moment|security check|verify (?:that )?you are human)\b/i;

const RENDERED_PAGE_INSPECTION_SCRIPT = `(() => {
    const marker = '__SCREENSHOT_VALIDATION__';
    const normalizeText = (value) =>
        String(value ?? '').replace(/\\s+/g, ' ').trim();
    const isInViewport = (rect) =>
        rect.width > 1 &&
        rect.height > 1 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
    const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number.parseFloat(style.opacity || '1') > 0 &&
            isInViewport(element.getBoundingClientRect())
        );
    };
    const challengeSelector = [
        '[class~="g-recaptcha" i]',
        '[class~="h-captcha" i]',
        '[class~="cf-turnstile" i]',
        'iframe[src*="recaptcha" i]',
        'iframe[src*="hcaptcha.com" i]',
        'iframe[src*="/challenge-platform/" i]',
        'form[id="challenge-form" i]',
        'form[action*="/challenge-platform/" i]',
    ].join(', ');
    const visualContentTags = new Set([
        'input',
        'textarea',
        'select',
        'button',
        'img',
        'svg',
        'canvas',
        'video',
    ]);
    let visibleTextLength = 0;
    let visibleMediaCount = 0;

    if (document.body) {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
        );
        let textNode = walker.nextNode();
        while (textNode && visibleTextLength < 2000) {
            const text = normalizeText(textNode.textContent);
            const parent = textNode.parentElement;
            if (text && parent && isVisible(parent)) {
                const range = document.createRange();
                range.selectNodeContents(textNode);
                if (isInViewport(range.getBoundingClientRect())) {
                    visibleTextLength = Math.min(
                        2000,
                        visibleTextLength + text.length,
                    );
                }
            }
            textNode = walker.nextNode();
        }

        for (const element of document.body.querySelectorAll('*')) {
            if (!isVisible(element)) continue;

            const tagName = element.tagName.toLowerCase();
            const isVisualElement = visualContentTags.has(tagName);
            const hasBackgroundImage =
                window.getComputedStyle(element).backgroundImage !== 'none';
            if (isVisualElement || hasBackgroundImage) {
                visibleMediaCount += 1;
            }
        }
    }

    return {
        bodyText: normalizeText(document.body?.innerText).slice(0, 2000),
        hasChallengeElement: Boolean(document.querySelector(challengeSelector)),
        heading: normalizeText(document.querySelector('h1')?.textContent),
        title: normalizeText(document.title),
        visibleMediaCount,
        visibleTextLength,
        marker,
    };
})()`;

/** Browser-observed signals used to reject invalid rendered pages. */
interface RenderedPageState {
    /** Normalized document body text. */
    bodyText: string;
    /** Whether a known CAPTCHA or anti-bot widget is present. */
    hasChallengeElement: boolean;
    /** First page heading. */
    heading: string;
    /** Browser document title. */
    title: string;
    /** Number of visible media or background-image elements. */
    visibleMediaCount: number;
    /** Amount of text visible inside the capture viewport. */
    visibleTextLength: number;
}

/** Error raised when the browser did not render a usable page. */
export class InvalidRenderedPageError extends Error {}

/** Returns whether concise page copy names a known invalid render state. */
function isInvalidPageText(value: string): boolean {
    return INVALID_PAGE_TEXT.test(value.replace(/[.!…]+$/g, '').trim());
}

/** Returns whether page copy identifies an active browser challenge. */
function hasChallengePageCopy(state: RenderedPageState): boolean {
    return (
        [state.title, state.heading].some((value) =>
            CHALLENGE_PAGE_TEXT.test(value),
        ) ||
        (state.bodyText.length <= 600 &&
            CHALLENGE_PAGE_TEXT.test(state.bodyText))
    );
}

/** Rejects navigation errors, challenge pages, loading shells, and blank pages. */
export async function validateRenderedPage(options: {
    /** Page after its cleanup and lazy-media preparation steps. */
    page: Page;
    /** Main-document response returned by Playwright navigation. */
    navigationResponse: PlaywrightResponse | null;
}): Promise<void> {
    const status = options.navigationResponse?.status();
    if (status === undefined) {
        throw new InvalidRenderedPageError(
            'Screenshot target did not return an HTTP response',
        );
    }
    if (status < 200 || status >= 400) {
        throw new InvalidRenderedPageError(
            `Screenshot target returned HTTP ${status}`,
        );
    }

    const state = await options.page.evaluate<RenderedPageState>(
        RENDERED_PAGE_INSPECTION_SCRIPT,
    );
    const hasInvalidCopy = [state.title, state.heading, state.bodyText].some(
        isInvalidPageText,
    );
    const isChallengePage =
        state.hasChallengeElement && hasChallengePageCopy(state);
    const isBlank =
        state.visibleTextLength === 0 && state.visibleMediaCount === 0;

    if (isChallengePage || hasInvalidCopy || isBlank) {
        throw new InvalidRenderedPageError(
            'Screenshot target is not a valid rendered page',
        );
    }
}
