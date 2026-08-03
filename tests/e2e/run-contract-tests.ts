import assert from 'node:assert/strict';

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4010';
const fixtureUrl = process.env.E2E_FIXTURE_URL ?? 'http://fixture/';

/** JSON object returned by the screenshot API. */
interface JsonObject {
    /** Response fields. */
    [key: string]: unknown;
}

/** HTTP response with parsed JSON. */
interface JsonResponse {
    /** HTTP status code. */
    status: number;
    /** Parsed response body. */
    body: JsonObject;
}

/**
 * Posts JSON to the screenshot endpoint.
 *
 * @param payload - Request body.
 * @returns Status and parsed response JSON.
 */
async function capture(payload: JsonObject): Promise<JsonResponse> {
    const response = await fetch(`${apiBaseUrl}/screenshots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = (await response.json()) as JsonObject;
    return { status: response.status, body };
}

/**
 * Asserts that an unknown value is a JSON object.
 *
 * @param value - Value to inspect.
 * @param message - Assertion failure message.
 * @returns Narrowed JSON object.
 */
function expectObject(value: unknown, message: string): JsonObject {
    assert.ok(
        value && typeof value === 'object' && !Array.isArray(value),
        message,
    );
    return value as JsonObject;
}

/**
 * Runs public screenshot contract checks against the Docker stack.
 */
async function main(): Promise<void> {
    const invalid = await capture({});
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.ok, false);
    assert.equal(invalid.body.error, 'Invalid request body.');
    assert.ok(Array.isArray(invalid.body.details));

    const success = await capture({
        url: fixtureUrl,
        includeMobile: true,
        waitForMs: 0,
        resizeWaitMs: 0,
    });
    assert.equal(success.status, 200);
    assert.equal(success.body.ok, true);
    assert.equal(success.body.url, fixtureUrl);

    const desktop = expectObject(
        success.body.desktop,
        'Expected desktop screenshot.',
    );
    const mobile = expectObject(
        success.body.mobile,
        'Expected mobile screenshot.',
    );
    assert.ok(typeof desktop.base64 === 'string' && desktop.base64.length > 0);
    assert.ok(typeof mobile.base64 === 'string' && mobile.base64.length > 0);

    console.log('E2E contract tests passed.');
}

await main();
