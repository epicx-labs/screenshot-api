import { expect, test } from '@playwright/test';

import { postJson } from './helpers/http-client.js';
import { getFixtureUrl } from './helpers/paths.js';
import { assertFrozenShape } from './helpers/shape-freeze.js';

test('POST /screenshots invalid payload returns 400 with frozen validation shape', async () => {
    const response = await postJson('/screenshots', {});

    expect(response.status).toBe(400);
    await assertFrozenShape({
        contractFileName: 'screenshots.validation.shape.json',
        payload: response.body,
    });
});

test('POST /screenshots fixture happy path returns 200 with frozen success shape', async () => {
    const response = await postJson('/screenshots', {
        url: getFixtureUrl(),
        includeMobile: true,
        waitForMs: 0,
        resizeWaitMs: 0,
    });

    expect(response.status).toBe(200);
    await assertFrozenShape({
        contractFileName: 'screenshots.success.shape.json',
        payload: response.body,
    });
});
