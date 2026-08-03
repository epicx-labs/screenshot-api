import { getApiBaseUrl } from './paths.js';

/**
 * JSON response envelope used by E2E request helpers.
 */
export interface JsonHttpResponse {
    /**
     * HTTP status code.
     */
    status: number;
    /**
     * Parsed JSON response body.
     */
    body: unknown;
}

/**
 * Sends an HTTP request to the screenshot API and parses its JSON body.
 *
 * @param pathname - Endpoint path such as `/health` or `/screenshots`.
 * @param init - Optional fetch configuration.
 * @returns Response status and parsed JSON body.
 */
export async function requestJson(
    pathname: string,
    init?: RequestInit,
): Promise<JsonHttpResponse> {
    const requestUrl = new URL(pathname, getApiBaseUrl());
    const response = await fetch(requestUrl, init);
    const rawBody = await response.text();
    const body = rawBody.length > 0 ? (JSON.parse(rawBody) as unknown) : null;

    return {
        status: response.status,
        body,
    };
}

/**
 * Sends a JSON POST request to a screenshot API endpoint.
 *
 * @param pathname - Endpoint path such as `/screenshots`.
 * @param payload - JSON-serializable request payload.
 * @returns Response status and parsed JSON body.
 */
export async function postJson(
    pathname: string,
    payload: Record<string, unknown>,
): Promise<JsonHttpResponse> {
    return requestJson(pathname, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
}
