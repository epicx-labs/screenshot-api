import path from 'node:path';

/**
 * Default host URL used by E2E tests to call the API container.
 */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:4010';

/**
 * Default fixture URL passed to the screenshot endpoint.
 */
export const DEFAULT_FIXTURE_URL = 'http://fixture/';

/**
 * Resolves the active API base URL from environment overrides.
 *
 * @returns API base URL used for endpoint calls.
 */
export function getApiBaseUrl(): string {
    const value = process.env.E2E_API_BASE_URL;
    return value && value.trim().length > 0
        ? value.trim()
        : DEFAULT_API_BASE_URL;
}

/**
 * Resolves the fixture URL used as the screenshot target.
 *
 * @returns Fixture URL resolvable by the app container.
 */
export function getFixtureUrl(): string {
    const value = process.env.E2E_FIXTURE_URL;
    return value && value.trim().length > 0
        ? value.trim()
        : DEFAULT_FIXTURE_URL;
}

/**
 * Resolves an absolute path for an E2E contract shape file.
 *
 * @param fileName - Contract shape file name inside `tests/e2e/contracts`.
 * @returns Absolute file path to the contract shape file.
 */
export function resolveContractPath(fileName: string): string {
    return path.resolve(process.cwd(), 'tests', 'e2e', 'contracts', fileName);
}
