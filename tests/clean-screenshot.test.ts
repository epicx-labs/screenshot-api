import { describe, expect, test, vi } from 'vitest';

import {
    dismissScreenshotBlockers,
    prepareCleanScreenshot,
    prepareLazyMedia,
} from '../src/modules/screenshots/clean-screenshot.js';

/**
 * Rectangle returned by the fake element layout API.
 */
interface FakeRect {
    /** Element left coordinate in CSS pixels. */
    left?: number;
    /** Element right coordinate in CSS pixels. */
    right?: number;
    /** Element top coordinate in CSS pixels. */
    top?: number;
    /** Element bottom coordinate in CSS pixels. */
    bottom?: number;
    /** Element width in CSS pixels. */
    width: number;
    /** Element height in CSS pixels. */
    height: number;
}

/**
 * Style values returned by the fake computed style API.
 */
interface FakeComputedStyle {
    /** CSS display value. */
    display: string;
    /** CSS visibility value. */
    visibility: string;
    /** CSS opacity value. */
    opacity: string;
    /** CSS position value. */
    position: string;
    /** CSS background color value. */
    backgroundColor: string;
}

/**
 * Constructor options for fake DOM elements.
 */
interface FakeElementOptions {
    /** User-visible text content. */
    textContent?: string;
    /** Fake element attributes. */
    attributes?: Record<string, string>;
    /** Fake bounding rectangle. */
    rect?: FakeRect;
    /** Fake computed style. */
    computedStyle?: Partial<FakeComputedStyle>;
    /** Child elements returned from scoped queries. */
    children?: FakeElement[];
}

class FakeStyle {
    readonly values = new Map<string, string>();
    readonly priorities = new Map<string, string>();

    /**
     * Stores an inline style value.
     *
     * @param name - CSS property name.
     * @param value - CSS property value.
     * @param priority - Optional CSS priority.
     */
    setProperty(name: string, value: string, priority = ''): void {
        this.values.set(name, value);
        this.priorities.set(name, priority);
    }

    /**
     * Reads an inline style value.
     *
     * @param name - CSS property name.
     * @returns CSS property value.
     */
    getPropertyValue(name: string): string {
        return this.values.get(name) ?? '';
    }

    /**
     * Reads an inline style priority.
     *
     * @param name - CSS property name.
     * @returns CSS property priority.
     */
    getPropertyPriority(name: string): string {
        return this.priorities.get(name) ?? '';
    }

    /**
     * Removes an inline style value.
     *
     * @param name - CSS property name.
     */
    removeProperty(name: string): void {
        this.values.delete(name);
        this.priorities.delete(name);
    }
}

class FakeElement {
    readonly style = new FakeStyle();
    readonly attributes = new Map<string, string>();
    readonly children: FakeElement[];
    readonly rect: FakeRect;
    readonly computedStyle: FakeComputedStyle;
    parentElement: FakeElement | null = null;
    textContent: string;
    tagName: string;

    constructor(options: FakeElementOptions = {}) {
        this.textContent = options.textContent ?? '';
        this.tagName = options.attributes?.tagName ?? 'DIV';
        for (const [name, value] of Object.entries(options.attributes ?? {})) {
            this.attributes.set(name, value);
        }
        const rect = options.rect ?? { width: 100, height: 40 };
        this.rect = {
            left: rect.left ?? 0,
            right: rect.right ?? (rect.left ?? 0) + rect.width,
            top: rect.top ?? 0,
            bottom: rect.bottom ?? (rect.top ?? 0) + rect.height,
            width: rect.width,
            height: rect.height,
        };
        this.children = options.children ?? [];
        for (const child of this.children) {
            child.parentElement = this;
        }
        this.computedStyle = {
            backgroundColor: 'transparent',
            display: 'block',
            visibility: 'visible',
            opacity: '1',
            position: 'static',
            ...options.computedStyle,
        };
    }

    /**
     * Reads a fake attribute value.
     *
     * @param name - Attribute name.
     * @returns Attribute value or null.
     */
    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    /**
     * Writes a fake attribute value.
     *
     * @param name - Attribute name.
     * @param value - Attribute value.
     */
    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    /**
     * Returns fake child elements for scoped DOM queries.
     *
     * @returns Child elements.
     */
    querySelectorAll(): FakeElement[] {
        return this.children;
    }

    /**
     * Returns fake element layout.
     *
     * @returns Fake element rectangle.
     */
    getBoundingClientRect(): FakeRect {
        return this.rect;
    }

    /**
     * Handles click events for fake controls.
     */
    click(): void {
        // Overridden by clickable controls in tests.
    }
}

/**
 * Checks whether a fake element matches the simple selectors used by tests.
 *
 * @param element - Fake element to inspect.
 * @param selector - Selector string from a DOM query.
 * @returns Whether the fake element matches.
 */
function matchesFakeSelector(element: FakeElement, selector: string): boolean {
    const selectorParts = selector.split(',').map((part) => part.trim());

    return selectorParts.some((part) => {
        if (part === 'body *') {
            return true;
        }

        if (
            part === 'button' ||
            part === '[role="button"]' ||
            part === 'a' ||
            part.startsWith('input[')
        ) {
            return true;
        }

        if (part.startsWith('#')) {
            return element.getAttribute('id') === part.slice(1);
        }

        if (part.startsWith('.')) {
            const className = element.getAttribute('class') ?? '';

            return className.split(/\s+/).includes(part.slice(1));
        }

        const attributeContains = part.match(/^\[(id|class)\*="([^"]+)" i\]$/);
        if (attributeContains) {
            const [, attributeName, expected] = attributeContains;
            const value = element.getAttribute(attributeName ?? '') ?? '';

            return value.toLowerCase().includes((expected ?? '').toLowerCase());
        }

        return false;
    });
}

/**
 * Installs enough DOM globals to execute the browser cleanup callback.
 *
 * @param bodyElements - Elements returned by `document.querySelectorAll`.
 * @returns Function that restores previous globals.
 */
function installFakeDom(bodyElements: FakeElement[]): () => void {
    const previous = {
        document: globalThis.document,
        Element: globalThis.Element,
        HTMLElement: globalThis.HTMLElement,
        HTMLInputElement: globalThis.HTMLInputElement,
        window: globalThis.window,
    };

    Object.assign(globalThis, {
        document: {
            querySelectorAll: (selector = '') =>
                bodyElements.filter((element) =>
                    matchesFakeSelector(element, selector),
                ),
        },
        Element: FakeElement,
        HTMLElement: FakeElement,
        HTMLInputElement: class FakeInputElement extends FakeElement {},
        window: {
            innerWidth: 1200,
            innerHeight: 800,
            getComputedStyle: (element: FakeElement) => element.computedStyle,
        },
    });

    return () => {
        Object.assign(globalThis, previous);
    };
}

describe('dismissScreenshotBlockers', () => {
    test('runs cleanup as a browser string to avoid dev-transform helpers', async () => {
        const evaluate = vi.fn().mockResolvedValue(undefined);

        await dismissScreenshotBlockers({
            evaluate,
            waitForTimeout: vi.fn(),
        });

        expect(evaluate).toHaveBeenCalledWith(expect.any(String));
        expect(evaluate.mock.calls[0]?.[0]).not.toContain('__name');
    });

    test('runs cleanup inside child frames', async () => {
        const evaluate = vi.fn().mockResolvedValue(undefined);
        const mainFrame = { evaluate: vi.fn().mockResolvedValue(undefined) };
        const childFrame = { evaluate: vi.fn().mockResolvedValue(undefined) };

        await dismissScreenshotBlockers({
            evaluate,
            frames: () => [mainFrame, childFrame] as never,
            mainFrame: () => mainFrame as never,
            waitForTimeout: vi.fn(),
        });

        expect(evaluate).toHaveBeenCalledWith(expect.any(String));
        expect(mainFrame.evaluate).not.toHaveBeenCalled();
        expect(childFrame.evaluate).toHaveBeenCalledWith(expect.any(String));
    });

    test('clicks accept controls on cookie consent blockers', async () => {
        const acceptButton = new FakeElement({ textContent: 'Accept All' });
        const click = vi.fn();
        acceptButton.click = click;

        const banner = new FakeElement({
            textContent:
                'We value your privacy. We use cookies to enhance browsing.',
            rect: { width: 1200, height: 72 },
            computedStyle: { position: 'fixed' },
            children: [acceptButton],
        });
        const restoreDom = installFakeDom([banner]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(click).toHaveBeenCalledTimes(1);
    });

    test('does not treat cookie words as ok accept actions', async () => {
        const manageButton = new FakeElement({ textContent: 'Manage cookies' });
        const acceptButton = new FakeElement({ textContent: 'Accept All' });
        const manageClick = vi.fn();
        const acceptClick = vi.fn();
        manageButton.click = manageClick;
        acceptButton.click = acceptClick;

        const banner = new FakeElement({
            textContent:
                'We use cookies to improve your experience on our website.',
            rect: { width: 1200, height: 72 },
            computedStyle: { position: 'fixed' },
            children: [manageButton, acceptButton],
        });
        const restoreDom = installFakeDom([banner]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(manageClick).not.toHaveBeenCalled();
        expect(acceptClick).toHaveBeenCalledTimes(1);
    });

    test('ignores offscreen footer cookie preference links', async () => {
        const preferencesLink = new FakeElement({
            textContent: 'Cookie Preferences',
        });
        const click = vi.fn();
        preferencesLink.click = click;

        const footer = new FakeElement({
            textContent: 'Privacy policy. Cookie Preferences.',
            rect: { top: 1200, bottom: 1600, width: 1200, height: 400 },
            computedStyle: { position: 'static' },
            children: [preferencesLink],
        });
        const restoreDom = installFakeDom([footer]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(click).not.toHaveBeenCalled();
        expect(footer.style.values.get('display')).toBeUndefined();
    });

    test('clicks accept controls on static bottom cookie bars', async () => {
        const acceptButton = new FakeElement({ textContent: 'Accept All' });
        const click = vi.fn();
        acceptButton.click = click;

        const banner = new FakeElement({
            textContent:
                'We value your privacy. We use cookies to enhance browsing.',
            rect: { top: 728, bottom: 800, width: 1200, height: 72 },
            computedStyle: { position: 'static' },
            children: [acceptButton],
        });
        const restoreDom = installFakeDom([banner]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(click).toHaveBeenCalledTimes(1);
        expect(banner.style.values.get('display')).toBe('none');
    });

    test('clicks accept controls on static top cookie bars', async () => {
        const acceptButton = new FakeElement({ textContent: 'Accept All' });
        const click = vi.fn();
        acceptButton.click = click;

        const banner = new FakeElement({
            textContent:
                'We use cookies to improve your experience on our website.',
            rect: { top: 0, bottom: 64, width: 1200, height: 64 },
            computedStyle: { position: 'static' },
            children: [acceptButton],
        });
        const restoreDom = installFakeDom([banner]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(click).toHaveBeenCalledTimes(1);
        expect(banner.style.values.get('display')).toBe('none');
    });

    test('clicks accept controls on CookieYes banners', async () => {
        const acceptButton = new FakeElement({ textContent: 'Accept All' });
        const click = vi.fn();
        acceptButton.click = click;

        const banner = new FakeElement({
            textContent:
                'We value your privacy. We use cookies to enhance browsing.',
            attributes: {
                class: 'cky-consent-container cky-banner-bottom',
            },
            rect: { top: 685, bottom: 800, width: 1200, height: 115 },
            computedStyle: { position: 'fixed' },
            children: [acceptButton],
        });
        const restoreDom = installFakeDom([banner]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(click).toHaveBeenCalledTimes(1);
        expect(banner.style.values.get('display')).toBe('none');
    });

    test('preserves cookie-gated video posters by hiding instead of accepting', async () => {
        const acceptButton = new FakeElement({ textContent: 'Accept All' });
        const click = vi.fn();
        acceptButton.click = click;

        const banner = new FakeElement({
            textContent:
                'We value your privacy. We use cookies to enhance browsing.',
            attributes: {
                class: 'cky-consent-container cky-banner-bottom',
            },
            rect: { top: 685, bottom: 800, width: 1200, height: 115 },
            computedStyle: { position: 'fixed' },
            children: [acceptButton],
        });
        const placeholderText = new FakeElement({
            textContent: 'Please accept cookies to access this content',
            attributes: { class: 'video-placeholder-text-youtube' },
            rect: { top: 360, bottom: 392, width: 260, height: 32 },
            computedStyle: { position: 'static' },
        });
        const restoreDom = installFakeDom([banner, placeholderText]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(click).not.toHaveBeenCalled();
        expect(banner.style.values.get('display')).toBe('none');
        expect(placeholderText.style.values.get('display')).toBe('none');
    });

    test('hides compact privacy preference dialogs', async () => {
        const dialog = new FakeElement({
            textContent:
                'Privacy Preference Center. Manage Consent Preferences.',
            attributes: { role: 'dialog' },
            rect: { top: 180, bottom: 560, width: 420, height: 380 },
            computedStyle: { position: 'fixed' },
        });
        const restoreDom = installFakeDom([dialog]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(dialog.style.values.get('display')).toBe('none');
    });

    test('hides known vendor consent containers by selector', async () => {
        const dialog = new FakeElement({
            textContent: 'Privacy Preference Center. Manage cookies.',
            attributes: { id: 'onetrust-pc-sdk' },
            rect: { top: 260, bottom: 460, width: 300, height: 200 },
            computedStyle: { position: 'static' },
        });
        const restoreDom = installFakeDom([dialog]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(dialog.style.values.get('display')).toBe('none');
    });

    test('hides Finsweet cookie banners by selector', async () => {
        const banner = new FakeElement({
            textContent: 'We use cookies to improve your experience.',
            attributes: { class: 'fs-cc-banner_component' },
            rect: { top: 720, bottom: 800, width: 360, height: 80 },
            computedStyle: { position: 'static' },
        });
        const restoreDom = installFakeDom([banner]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(banner.style.values.get('display')).toBe('none');
    });

    test('hides small fixed edge contact widgets', async () => {
        const widget = new FakeElement({
            attributes: { class: 'xxysidebox' },
            rect: { top: 360, bottom: 420, left: 1150, width: 50, height: 60 },
            computedStyle: { position: 'fixed' },
        });
        const restoreDom = installFakeDom([widget]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(widget.attributes.get('data-clean-screenshot-hidden')).toBe(
            'true',
        );
        expect(widget.style.values.get('display')).toBe('none');
    });

    test('hides generic centered modal dialogs', async () => {
        const dialog = new FakeElement({
            textContent: 'Ready to create your favorite list?',
            attributes: { 'aria-modal': 'true' },
            rect: { top: 220, bottom: 500, width: 360, height: 280 },
            computedStyle: { position: 'fixed' },
        });
        const restoreDom = installFakeDom([dialog]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(dialog.style.values.get('display')).toBe('none');
    });

    test('hides small cookie-gated content overlays', async () => {
        const gate = new FakeElement({
            textContent: 'Please accept cookies to access this content',
            rect: { top: 360, bottom: 392, width: 260, height: 32 },
            computedStyle: { position: 'static' },
        });
        const restoreDom = installFakeDom([gate]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(gate.attributes.get('data-clean-screenshot-hidden')).toBe(
            'true',
        );
        expect(gate.style.values.get('display')).toBe('none');
    });

    test('does not hide large page wrappers that contain cookie text', async () => {
        const wrapper = new FakeElement({
            textContent:
                'Product hero content. We value your privacy and use cookies.',
            rect: { top: 0, bottom: 800, width: 1200, height: 800 },
            computedStyle: { position: 'static' },
        });
        const restoreDom = installFakeDom([wrapper]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(
            wrapper.attributes.get('data-clean-screenshot-hidden'),
        ).toBeUndefined();
        expect(wrapper.style.values.get('display')).toBeUndefined();
    });

    test('preserves page header navigation with sign up controls', async () => {
        const header = new FakeElement({
            textContent: 'ficustree Home How it works Pricing Chat Sign up',
            attributes: { tagName: 'HEADER', role: 'banner' },
            rect: { top: 0, bottom: 64, width: 1200, height: 64 },
            computedStyle: { position: 'fixed' },
        });
        const restoreDom = installFakeDom([header]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(
            header.attributes.get('data-clean-screenshot-hidden'),
        ).toBeUndefined();
        expect(header.style.values.get('display')).toBeUndefined();
    });

    test('hides centered lead magnet modals and dark backdrops', async () => {
        const modal = new FakeElement({
            textContent:
                'Bought the $1M home. Got $20,000 back. Sign up now Sign up free Already have an account? Sign in',
            rect: {
                left: 420,
                right: 780,
                top: 120,
                bottom: 690,
                width: 360,
                height: 570,
            },
            computedStyle: { position: 'fixed' },
        });
        const backdrop = new FakeElement({
            rect: { top: 0, bottom: 800, width: 1200, height: 800 },
            computedStyle: {
                backgroundColor: 'rgba(0, 0, 0, 0.58)',
                position: 'fixed',
            },
        });
        const restoreDom = installFakeDom([backdrop, modal]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(modal.attributes.get('data-clean-screenshot-hidden')).toBe(
            'true',
        );
        expect(modal.style.values.get('display')).toBe('none');
        expect(backdrop.attributes.get('data-clean-screenshot-hidden')).toBe(
            'true',
        );
        expect(backdrop.style.values.get('display')).toBe('none');
    });

    test('hides absolute centered lead magnet popups with sign up controls', async () => {
        const modal = new FakeElement({
            textContent: 'Sign up Already have an account? Sign in',
            rect: {
                left: 420,
                right: 780,
                top: 120,
                bottom: 690,
                width: 360,
                height: 570,
            },
            computedStyle: { position: 'absolute' },
        });
        const restoreDom = installFakeDom([modal]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(modal.attributes.get('data-clean-screenshot-hidden')).toBe(
            'true',
        );
        expect(modal.style.values.get('display')).toBe('none');
    });

    test('hides full-screen lead magnet overlays', async () => {
        const overlay = new FakeElement({
            textContent: 'Sign up free Already have an account? Sign in',
            rect: {
                left: 0,
                right: 1200,
                top: 0,
                bottom: 800,
                width: 1200,
                height: 800,
            },
            computedStyle: {
                backgroundColor: 'oklab(0 0 0 / 0.65)',
                position: 'fixed',
            },
        });
        const restoreDom = installFakeDom([overlay]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(overlay.attributes.get('data-clean-screenshot-hidden')).toBe(
            'true',
        );
        expect(overlay.style.values.get('display')).toBe('none');
    });

    test('hides video consent text without hiding the hero wrapper', async () => {
        const placeholderText = new FakeElement({
            textContent: 'Please accept cookies to access this content',
            attributes: { class: 'video-placeholder-text-youtube' },
            rect: { top: 360, bottom: 392, width: 260, height: 32 },
            computedStyle: { position: 'static' },
        });
        const heroWrapper = new FakeElement({
            textContent: 'Please accept cookies to access this content',
            attributes: { class: 'video-placeholder-youtube' },
            rect: { top: 0, bottom: 800, width: 1200, height: 800 },
            computedStyle: { position: 'static' },
            children: [placeholderText],
        });
        const restoreDom = installFakeDom([heroWrapper, placeholderText]);

        try {
            await dismissScreenshotBlockers({
                evaluate: async (script: string) => {
                    if (typeof script !== 'string') {
                        throw new TypeError('expected browser script string');
                    }
                    Function(script)();
                },
                waitForTimeout: vi.fn(),
            });
        } finally {
            restoreDom();
        }

        expect(
            heroWrapper.attributes.get('data-clean-screenshot-hidden'),
        ).toBeUndefined();
        expect(heroWrapper.style.values.get('display')).toBeUndefined();
        expect(
            placeholderText.attributes.get('data-clean-screenshot-hidden'),
        ).toBe('true');
        expect(placeholderText.style.values.get('display')).toBe('none');
    });
});

describe('prepareLazyMedia', () => {
    test('returns to the top when the page uses smooth scrolling', async () => {
        const previous = {
            document: globalThis.document,
            requestAnimationFrame: globalThis.requestAnimationFrame,
            window: globalThis.window,
        };
        const documentElement = {
            scrollHeight: 2400,
            style: new FakeStyle(),
        };
        const body = { style: new FakeStyle() };
        const fakeWindow = {
            innerHeight: 1080,
            pendingScrollY: null as number | null,
            scrollX: 0,
            scrollY: 0,
            scrollTo: vi.fn(
                (
                    optionsOrX:
                        | number
                        | {
                              top?: number;
                          },
                    maybeY?: number,
                ) => {
                    const top =
                        typeof optionsOrX === 'number'
                            ? (maybeY ?? 0)
                            : (optionsOrX.top ?? 0);
                    const behavior =
                        documentElement.style.getPropertyValue(
                            'scroll-behavior',
                        ) || 'smooth';

                    if (behavior === 'auto') {
                        fakeWindow.scrollY = top;
                        fakeWindow.pendingScrollY = null;
                        return;
                    }

                    fakeWindow.pendingScrollY = top;
                },
            ),
        };

        Object.assign(globalThis, {
            document: {
                body,
                documentElement,
                querySelectorAll: () => [],
            },
            requestAnimationFrame: (callback: FrameRequestCallback) => {
                callback(0);
                return 0;
            },
            window: fakeWindow,
        });

        try {
            await prepareLazyMedia(
                {
                    evaluate: async (script: string) => {
                        Function(script)();
                    },
                    waitForTimeout: async () => {
                        if (fakeWindow.pendingScrollY !== null) {
                            fakeWindow.scrollY = fakeWindow.pendingScrollY;
                            fakeWindow.pendingScrollY = null;
                        }
                    },
                },
                500,
            );
        } finally {
            Object.assign(globalThis, previous);
        }

        expect(fakeWindow.scrollY).toBe(0);
    });
});

describe('prepareCleanScreenshot', () => {
    test('hides CookieYes notices that appear during lazy media preparation', async () => {
        const banner = new FakeElement({
            textContent:
                'We value your privacy. We use cookies to enhance browsing. Accept All',
            attributes: {
                class: 'cky-consent-bar',
                'data-cky-tag': 'notice',
            },
            rect: { top: 685, bottom: 800, width: 1200, height: 115 },
            computedStyle: { position: 'static' },
        });
        const bodyElements: FakeElement[] = [];
        const restoreDom = installFakeDom(bodyElements);

        try {
            await prepareCleanScreenshot({
                page: {
                    evaluate: async (script: string) => {
                        if (typeof script !== 'string') {
                            throw new TypeError(
                                'expected browser script string',
                            );
                        }

                        if (script.includes('blockerWords')) {
                            Function(script)();
                        }
                    },
                    waitForTimeout: async () => {
                        bodyElements.push(banner);
                    },
                },
                lazyLoadWaitMs: 1,
            });
        } finally {
            restoreDom();
        }

        expect(banner.attributes.get('data-clean-screenshot-hidden')).toBe(
            'true',
        );
        expect(banner.style.values.get('display')).toBe('none');
    });
});
