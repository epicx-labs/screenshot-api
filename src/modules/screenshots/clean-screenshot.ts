import type { Page } from 'playwright';

const CLEAN_SCREENSHOT_STYLE_ID = 'crawler-clean-screenshot-style';

/**
 * Minimal Playwright page methods needed to prepare a clean screenshot.
 */
export interface CleanScreenshotPage {
    /** Evaluates a browser-side cleanup callback. */
    evaluate: Page['evaluate'];
    /** Returns page frames when child-frame cleanup is available. */
    frames?: Page['frames'];
    /** Returns the main frame so cleanup can avoid duplicate work. */
    mainFrame?: Page['mainFrame'];
    /** Waits after scroll-driven lazy media triggers. */
    waitForTimeout: Page['waitForTimeout'];
}

/**
 * Options for preparing a page before screenshot capture.
 */
export interface PrepareCleanScreenshotOptions {
    /** Page for the active screenshot viewport. */
    page: CleanScreenshotPage;
    /** Delay after the near-fold scroll pass so lazy media can render. */
    lazyLoadWaitMs: number;
    /** Optional warning sink for best-effort cleanup failures. */
    onWarning?: (phase: string, error: unknown) => void;
}

/**
 * Prepares the current viewport for a clean screenshot.
 *
 * @param options - Clean screenshot preparation options.
 */
export async function prepareCleanScreenshot(
    options: PrepareCleanScreenshotOptions,
): Promise<void> {
    const { page, lazyLoadWaitMs, onWarning } = options;

    await runBestEffort(
        'dismiss blockers',
        async () => dismissScreenshotBlockers(page),
        onWarning,
    );
    await runBestEffort(
        'prepare lazy media',
        async () => prepareLazyMedia(page, lazyLoadWaitMs),
        onWarning,
    );
    await runBestEffort(
        'freeze dynamic media',
        async () => freezeDynamicMedia(page),
        onWarning,
    );
    await runBestEffort(
        'dismiss late blockers',
        async () => dismissScreenshotBlockers(page),
        onWarning,
    );
}

/**
 * Dismisses or hides common screenshot blockers in the browser DOM.
 *
 * @param page - Page for the active screenshot viewport.
 */
export async function dismissScreenshotBlockers(
    page: CleanScreenshotPage,
): Promise<void> {
    const blockerScript = `(() => {
        const blockerWords = [
            'cookie',
            'cookies',
            'consent',
            'privacy',
            'newsletter',
            'subscribe',
            'age verification',
            'verify age',
            'modal',
        ];
        const leadMagnetActionPhrases = [
            'sign up',
            'sign up free',
            'sign up now',
            'already have an account',
            'create account',
            'get started',
            'join waitlist',
        ];
        const acceptActionPhrases = [
            'accept all',
            'accept cookies',
            'accept',
            'allow all',
            'agree',
            'i agree',
            'ok',
            'okay',
        ];
        const dismissActionPhrases = [
            'reject all',
            'reject',
            'decline',
            'deny',
            'necessary only',
            'only necessary',
            'essential only',
            'only essential',
            'save preferences',
            'close',
            'dismiss',
            'no thanks',
            'got it',
        ];
        const consentIdentityWords = [
            'cky',
            'cookieyes',
            'cookie',
            'cookies',
            'consent',
            'onetrust',
            'ot-sdk',
            'didomi',
            'trustarc',
            'truste',
            'quantcast',
            'qc-cmp',
            'cookiebot',
            'cybotcookiebot',
            'cc-window',
            'cc-banner',
            'gdpr',
            'privacy',
        ];
        const placeholderTextIdentityWords = [
            'video-placeholder-text',
            'cookie-placeholder-text',
            'consent-placeholder-text',
            'privacy-placeholder-text',
        ];
        const floatingWidgetIdentityWords = [
            'chat',
            'contact',
            'crisp',
            'drift',
            'floating',
            'help',
            'intercom',
            'message',
            'messenger',
            'quote',
            'sidebox',
            'support',
            'tawk',
            'whatsapp',
            'widget',
            'zendesk',
        ];
        const controlsSelector = [
            'button',
            '[role="button"]',
            'a',
            'input[type="button"]',
            'input[type="submit"]',
        ].join(',');
        const forcedBlockerSelectors = [
            '#onetrust-banner-sdk',
            '#onetrust-pc-sdk',
            '.onetrust-pc-dark-filter',
            '.ot-sdk-container',
            '.ot-sdk-row',
            '[id*="onetrust" i]',
            '[class*="onetrust" i]',
            '[id*="ot-sdk" i]',
            '[class*="ot-sdk" i]',
            '#CybotCookiebotDialog',
            '[id*="Cookiebot" i]',
            '[class*="cookiebot" i]',
            '.cky-consent-container',
            '.cky-modal',
            '.cky-overlay',
            '.fs-cc-banner_component',
            '.fs-cc-prefs_component',
            '.fs-cc-manager_component',
            '[class*="fs-cc-" i]',
            '[id*="hs-cookie" i]',
            '[class*="hs-cookie" i]',
        ];

        /**
         * Reads user-visible text or labels from one element.
         *
         * @param element - Element to describe.
         * @returns Lowercase label text.
         */
        const getElementLabel = (element) => {
            if (element instanceof HTMLInputElement) {
                return [
                    element.value,
                    element.getAttribute('aria-label'),
                    element.getAttribute('title'),
                ]
                    .filter((value) => Boolean(value))
                    .join(' ')
                    .trim()
                    .toLowerCase();
            }

            return [
                element.textContent,
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
            ]
                .filter((value) => Boolean(value))
                .join(' ')
                .replace(/\\s+/g, ' ')
                .trim()
                .toLowerCase();
        };

        /**
         * Reads class/id-like markers that identify consent vendor widgets.
         *
         * @param element - Element to describe.
         * @returns Lowercase identity text.
         */
        const getElementIdentity = (element) => {
            const className =
                typeof element.className === 'string'
                    ? element.className
                    : '';

            return [
                element.id,
                className,
                element.getAttribute('id'),
                element.getAttribute('class'),
                element.getAttribute('role'),
                element.getAttribute('aria-label'),
                element.getAttribute('data-testid'),
            ]
                .filter((value) => Boolean(value))
                .join(' ')
                .replace(/\\s+/g, ' ')
                .trim()
                .toLowerCase();
        };

        /**
         * Checks whether an element is visible enough for blocker handling.
         *
         * @param element - Element to inspect.
         * @returns Whether the element has visible layout.
         */
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.top < window.innerHeight &&
                rect.right > 0 &&
                rect.left < window.innerWidth
            );
        };

        /**
         * Checks whether text mentions a common screenshot blocker topic.
         *
         * @param text - Text to inspect.
         * @returns Whether the text matches a blocker topic.
         */
        const hasBlockerText = (text) =>
            blockerWords.some((word) => text.includes(word));

        /**
         * Checks whether text names an explicit cookie-gated content placeholder.
         *
         * @param text - Text to inspect.
         * @returns Whether the text is a cookie-gated content message.
         */
        const hasExplicitCookieGateText = (text) =>
            text.includes('please accept cookies') ||
            text.includes('accept cookies to access');

        /**
         * Checks whether text contains an action phrase as whole words.
         *
         * @param text - Text to inspect.
         * @param phrase - Action phrase to match.
         * @returns Whether the phrase is present with word boundaries.
         */
        const hasBoundedActionPhrase = (text, phrase) => {
            const normalizedText = \` \${text.replace(/[^a-z0-9]+/g, ' ')} \`;
            const normalizedPhrase = \` \${phrase.replace(
                /[^a-z0-9]+/g,
                ' ',
            )} \`;

            return normalizedText.includes(normalizedPhrase);
        };

        /**
         * Checks whether text names a consent acceptance action.
         *
         * @param text - Text to inspect.
         * @returns Whether the text matches an accept action.
         */
        const hasAcceptAction = (text) =>
            acceptActionPhrases.some((phrase) =>
                hasBoundedActionPhrase(text, phrase),
            );

        /**
         * Checks whether text names a promotional signup blocker.
         *
         * @param text - Text to inspect.
         * @returns Whether the text matches a lead magnet action.
         */
        const hasLeadMagnetAction = (text) =>
            leadMagnetActionPhrases.some((phrase) =>
                hasBoundedActionPhrase(text, phrase),
            );

        /**
         * Checks whether text names a safe fallback dismissal action.
         *
         * @param text - Text to inspect.
         * @returns Whether the text matches a dismissal action.
         */
        const hasDismissAction = (text) =>
            dismissActionPhrases.some((phrase) =>
                hasBoundedActionPhrase(text, phrase),
            );

        /**
         * Checks whether an element identity belongs to a known consent widget.
         *
         * @param element - Element to inspect.
         * @returns Whether class/id markers look consent-related.
         */
        const hasConsentIdentity = (element) => {
            const identity = getElementIdentity(element);

            return consentIdentityWords.some((word) =>
                identity.includes(word),
            );
        };

        /**
         * Checks whether an element identity is a small consent placeholder label.
         *
         * @param element - Element to inspect.
         * @returns Whether class/id markers look like placeholder text.
         */
        const hasPlaceholderTextIdentity = (element) => {
            const identity = getElementIdentity(element);

            return placeholderTextIdentityWords.some((word) =>
                identity.includes(word),
            );
        };

        /**
         * Checks whether an element identity belongs to a floating contact widget.
         *
         * @param element - Element to inspect.
         * @returns Whether class/id markers look widget-related.
         */
        const hasFloatingWidgetIdentity = (element) => {
            const identity = [
                getElementIdentity(element),
                getElementLabel(element),
            ].join(' ');

            return floatingWidgetIdentityWords.some((word) =>
                identity.includes(word),
            );
        };

        /**
         * Checks whether an element is likely site chrome that should remain visible.
         *
         * @param element - Element to inspect.
         * @returns Whether the element belongs to header or navigation chrome.
         */
        const isPreservedPageChrome = (element) => {
            let current = element;

            for (let depth = 0; current && depth < 6; depth += 1) {
                const tagName =
                    typeof current.tagName === 'string'
                        ? current.tagName.toLowerCase()
                        : '';
                const role = current.getAttribute('role');

                if (
                    tagName === 'header' ||
                    tagName === 'nav' ||
                    role === 'banner' ||
                    role === 'navigation'
                ) {
                    return true;
                }

                current = current.parentElement;
            }

            return false;
        };

        /**
         * Checks whether an element looks like a centered modal panel.
         *
         * @param element - Element to inspect.
         * @returns Whether the element is sized and positioned like a modal panel.
         */
        const isCenteredOverlayPanel = (element) => {
            const rect = element.getBoundingClientRect();
            const viewportArea = window.innerWidth * window.innerHeight;
            const area = rect.width * rect.height;
            const horizontallyCentered =
                rect.left >= window.innerWidth * 0.05 &&
                rect.right <= window.innerWidth * 0.95;
            const verticallyCentered =
                rect.top >= 24 && rect.bottom <= window.innerHeight - 24;

            return (
                rect.width >= 240 &&
                rect.height >= 160 &&
                area >= viewportArea * 0.04 &&
                area <= viewportArea * 0.7 &&
                horizontallyCentered &&
                verticallyCentered
            );
        };

        /**
         * Checks whether an element covers the viewport like a modal overlay.
         *
         * @param element - Element to inspect.
         * @returns Whether the element is a fixed full-screen overlay.
         */
        const isFullViewportOverlay = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const viewportArea = window.innerWidth * window.innerHeight;
            const area = rect.width * rect.height;

            return (
                style.position === 'fixed' &&
                rect.width >= window.innerWidth * 0.9 &&
                rect.height >= window.innerHeight * 0.75 &&
                area >= viewportArea * 0.75
            );
        };

        /**
         * Checks whether a color string is a dark translucent overlay.
         *
         * @param color - CSS color string.
         * @returns Whether the color looks like a modal backdrop.
         */
        const isDarkTranslucentColor = (color) => {
            const match = color
                .replace(/\\s+/g, '')
                .match(/^rgba?\\((\\d+),(\\d+),(\\d+)(?:,([\\d.]+))?\\)$/);
            if (!match) {
                return false;
            }

            const red = Number(match[1]);
            const green = Number(match[2]);
            const blue = Number(match[3]);
            const alpha =
                match[4] === undefined ? 1 : Number.parseFloat(match[4]);

            return red <= 80 && green <= 80 && blue <= 80 && alpha >= 0.25;
        };

        /**
         * Checks whether an element is a dark full-viewport modal backdrop.
         *
         * @param element - Element to inspect.
         * @returns Whether the element looks like a backdrop.
         */
        const isDarkBackdropCandidate = (element) => {
            if (!isVisible(element) || isPreservedPageChrome(element)) {
                return false;
            }

            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const viewportArea = window.innerWidth * window.innerHeight;
            const area = rect.width * rect.height;

            return (
                style.position === 'fixed' &&
                area >= viewportArea * 0.75 &&
                isDarkTranslucentColor(style.backgroundColor)
            );
        };

        /**
         * Checks whether an element is a compact fixed edge overlay.
         *
         * @param element - Element to inspect.
         * @returns Whether the element is small and anchored to a viewport edge.
         */
        const isSmallFixedEdgeWidget = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const viewportArea = window.innerWidth * window.innerHeight;
            const area = rect.width * rect.height;
            const nearHorizontalEdge =
                rect.left <= 8 || rect.right >= window.innerWidth - 8;
            const nearVerticalEdge =
                rect.top <= 8 || rect.bottom >= window.innerHeight - 8;

            return (
                style.position === 'fixed' &&
                rect.width <= 240 &&
                rect.height <= 240 &&
                area <= viewportArea * 0.08 &&
                (nearHorizontalEdge || nearVerticalEdge)
            );
        };

        /**
         * Checks whether an explicit cookie gate is small enough to hide safely.
         *
         * @param element - Element to inspect.
         * @returns Whether the element is a scoped text gate.
         */
        const isSmallCookieGate = (element) => {
            const rect = element.getBoundingClientRect();
            const viewportArea = window.innerWidth * window.innerHeight;
            const area = rect.width * rect.height;

            return (
                hasPlaceholderTextIdentity(element) ||
                area <= viewportArea * 0.05 ||
                (rect.width <= window.innerWidth * 0.4 && rect.height <= 120)
            );
        };

        /**
         * Checks whether an element looks like an overlay blocker.
         *
         * @param element - Element to inspect.
         * @returns Whether the element is a scoped blocker candidate.
         */
        const isBlockerCandidate = (element) => {
            if (!isVisible(element)) {
                return false;
            }

            if (isPreservedPageChrome(element)) {
                return false;
            }

            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const viewportArea = window.innerWidth * window.innerHeight;
            const area = rect.width * rect.height;
            const role = element.getAttribute('role');
            const ariaModal = element.getAttribute('aria-modal');
            const positioned =
                style.position === 'absolute' ||
                style.position === 'fixed' ||
                style.position === 'sticky';
            const nearViewportTop = rect.top <= 8;
            const nearViewportBottom =
                rect.bottom >= window.innerHeight - 8;
            const dialogLike =
                role === 'dialog' ||
                role === 'alertdialog' ||
                ariaModal === 'true';
            const coversMeaningfulArea =
                area >= viewportArea * 0.08 ||
                (rect.width >= window.innerWidth * 0.5 && rect.height >= 48);
            const wideEdgeBanner =
                rect.width >= window.innerWidth * 0.5 &&
                rect.height >= 32 &&
                rect.height <= window.innerHeight * 0.35 &&
                (nearViewportBottom || nearViewportTop);
            const text = getElementLabel(element);
            const explicitCookieGate = hasExplicitCookieGateText(text);
            const smallCookieGate =
                explicitCookieGate && isSmallCookieGate(element);
            const genericDialogBlocker =
                dialogLike &&
                area >= viewportArea * 0.01 &&
                area <= viewportArea * 0.7;
            const leadMagnetBlocker =
                hasLeadMagnetAction(text) &&
                (dialogLike ||
                    isFullViewportOverlay(element) ||
                    (positioned && isCenteredOverlayPanel(element)));
            const consentSystemBlocker =
                hasConsentIdentity(element) &&
                hasBlockerText(text) &&
                (positioned ||
                    dialogLike ||
                    wideEdgeBanner ||
                    nearViewportBottom ||
                    nearViewportTop ||
                    coversMeaningfulArea);
            const floatingWidgetBlocker =
                hasFloatingWidgetIdentity(element) &&
                isSmallFixedEdgeWidget(element);

            return (
                consentSystemBlocker ||
                floatingWidgetBlocker ||
                genericDialogBlocker ||
                leadMagnetBlocker ||
                (hasBlockerText(text) &&
                    (smallCookieGate ||
                        (coversMeaningfulArea &&
                            (positioned || dialogLike || wideEdgeBanner))))
            );
        };

        /**
         * Adds an element once while preserving discovery order.
         *
         * @param elements - Existing element list.
         * @param element - Element to add.
         */
        const addUniqueElement = (elements, element) => {
            if (!elements.includes(element)) {
                elements.push(element);
            }
        };

        const allElements = Array.from(document.querySelectorAll('body *'));
        const candidates = [];
        const shouldClickConsentControls = !allElements.some(
            (element) =>
                isVisible(element) &&
                hasExplicitCookieGateText(getElementLabel(element)) &&
                isSmallCookieGate(element),
        );

        for (const element of allElements) {
            if (isBlockerCandidate(element)) {
                addUniqueElement(candidates, element);
            }
        }

        if (candidates.length > 0) {
            for (const element of allElements) {
                if (isDarkBackdropCandidate(element)) {
                    addUniqueElement(candidates, element);
                }
            }
        }

        for (const selector of forcedBlockerSelectors) {
            for (const element of document.querySelectorAll(selector)) {
                if (isVisible(element)) {
                    addUniqueElement(candidates, element);
                }
            }
        }

        /**
         * Finds the nearest blocker container for a consent action control.
         *
         * @param element - Control element to inspect.
         * @returns Blocker container or null.
         */
        const findBlockerContainer = (element) => {
            let current = element;

            for (let depth = 0; current && depth < 8; depth += 1) {
                if (isBlockerCandidate(current)) {
                    return current;
                }

                current = current.parentElement;
            }

            return null;
        };

        const directControls = Array.from(
            document.querySelectorAll(controlsSelector),
        ).filter(isVisible);

        if (shouldClickConsentControls) {
            for (const control of directControls) {
                const label = getElementLabel(control);
                if (!hasAcceptAction(label)) {
                    continue;
                }

                const container = findBlockerContainer(control);
                if (!container) {
                    continue;
                }

                control.click();
                addUniqueElement(candidates, container);
            }

            for (const candidate of candidates) {
                const controls = Array.from(
                    candidate.querySelectorAll(controlsSelector),
                ).filter(isVisible);
                const acceptControl = controls.find((control) =>
                    hasAcceptAction(getElementLabel(control)),
                );
                const dismissControl = controls.find((control) =>
                    hasDismissAction(getElementLabel(control)),
                );
                const preferredControl = acceptControl ?? dismissControl;

                preferredControl?.click();
            }
        }

        for (const candidate of candidates) {
            if (!isVisible(candidate)) {
                continue;
            }

            candidate.setAttribute('data-crawler-clean-hidden', 'true');
            candidate.style.setProperty('display', 'none', 'important');
            candidate.style.setProperty('visibility', 'hidden', 'important');
        }
    })()`;

    await page.evaluate(blockerScript);

    const mainFrame =
        typeof page.mainFrame === 'function' ? page.mainFrame() : null;
    const frames = typeof page.frames === 'function' ? page.frames() : [];

    for (const frame of frames) {
        if (frame === mainFrame) {
            continue;
        }

        await frame.evaluate(blockerScript).catch(() => undefined);
    }
}

/**
 * Scrolls near the fold to trigger lazy media, then returns to the top.
 *
 * @param page - Page for the active screenshot viewport.
 * @param lazyLoadWaitMs - Delay after scrolling so lazy media can render.
 */
export async function prepareLazyMedia(
    page: CleanScreenshotPage,
    lazyLoadWaitMs: number,
): Promise<void> {
    await page.evaluate(`(() => {
        const lazySelector = [
            'img[loading="lazy"]',
            'iframe[loading="lazy"]',
            'img[data-src]',
            'img[data-srcset]',
            'iframe[data-src]',
            'source[data-src]',
            'source[data-srcset]',
            'video[preload="none"]',
            'video[preload="metadata"]',
        ].join(',');

        const lazyElements = Array.from(
            document.querySelectorAll(lazySelector),
        );

        for (const element of lazyElements) {
            if (
                element instanceof HTMLImageElement ||
                element instanceof HTMLIFrameElement
            ) {
                element.loading = 'eager';
            }

            const dataSrc = element.getAttribute('data-src');
            if (dataSrc && !element.getAttribute('src')) {
                element.setAttribute('src', dataSrc);
            }

            const dataSrcset = element.getAttribute('data-srcset');
            if (dataSrcset && !element.getAttribute('srcset')) {
                element.setAttribute('srcset', dataSrcset);
            }

            if (element instanceof HTMLVideoElement) {
                element.preload = 'metadata';
                element.load();
            }
        }

        const scrollContainers = [
            document.documentElement,
            document.body,
        ].filter(
            (element) =>
                element &&
                element.style &&
                typeof element.style.setProperty === 'function',
        );
        for (const element of scrollContainers) {
            element.style.setProperty(
                'scroll-behavior',
                'auto',
                'important',
            );
        }

        const maxScrollY = Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight,
        );
        const nearFoldY = Math.min(
            maxScrollY,
            Math.round(window.innerHeight * 0.9),
        );

        window.scrollTo({ left: 0, top: nearFoldY, behavior: 'auto' });
    })()`);

    if (lazyLoadWaitMs > 0) {
        await page.waitForTimeout(lazyLoadWaitMs);
    }

    await page.evaluate(`(() => new Promise((resolve) => {
        const scrollContainers = [
            document.documentElement,
            document.body,
        ].filter(
            (element) =>
                element &&
                element.style &&
                typeof element.style.setProperty === 'function',
        );
        for (const element of scrollContainers) {
            element.style.setProperty(
                'scroll-behavior',
                'auto',
                'important',
            );
        }

        window.scrollTo({ left: 0, top: 0, behavior: 'auto' });
        requestAnimationFrame(() => resolve(undefined));
    }))()`);
}

/**
 * Disables moving page effects before screenshot capture.
 *
 * @param page - Page for the active screenshot viewport.
 */
export async function freezeDynamicMedia(
    page: CleanScreenshotPage,
): Promise<void> {
    await page.evaluate(`(() => {
        const styleId = ${JSON.stringify(CLEAN_SCREENSHOT_STYLE_ID)};
        const existingStyle = document.getElementById(styleId);
        const style =
            existingStyle instanceof HTMLStyleElement
                ? existingStyle
                : document.createElement('style');

        style.id = styleId;
        style.textContent = [
            '*,',
            '*::before,',
            '*::after {',
            '    animation-delay: 0s !important;',
            '    animation-duration: 0.001s !important;',
            '    animation-iteration-count: 1 !important;',
            '    caret-color: transparent !important;',
            '    scroll-behavior: auto !important;',
            '    transition-delay: 0s !important;',
            '    transition-duration: 0s !important;',
            '}',
        ].join('\\n');

        if (!style.parentElement) {
            document.head.appendChild(style);
        }

        for (const video of document.querySelectorAll('video')) {
            video.pause();
        }
    })()`);
}

/**
 * Runs one clean-up step without letting it fail screenshot capture.
 *
 * @param phase - Human-readable clean-up phase.
 * @param action - Clean-up action to execute.
 * @param onWarning - Optional warning sink.
 */
async function runBestEffort(
    phase: string,
    action: () => Promise<void>,
    onWarning: ((phase: string, error: unknown) => void) | undefined,
): Promise<void> {
    try {
        await action();
    } catch (error) {
        onWarning?.(phase, error);
    }
}
