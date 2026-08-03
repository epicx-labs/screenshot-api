/** Default concurrent screenshot capacity. */
export const DEFAULT_MAX_IN_FLIGHT = 1;

/** Default queued screenshot capacity. */
export const DEFAULT_MAX_QUEUE = 50;

/** Default retry delay returned with `429` responses. */
export const DEFAULT_RETRY_AFTER_SECONDS = 10;

/**
 * Parses a positive integer from environment input.
 *
 * @param value - Raw environment value.
 * @param fallback - Value used when parsing fails.
 * @returns Positive integer.
 */
export function parsePositiveInt(
    value: string | undefined,
    fallback: number,
): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1
        ? Math.floor(parsed)
        : fallback;
}

/**
 * Resolves a positive numeric option.
 *
 * @param value - Candidate override.
 * @param fallback - Value used for invalid input.
 * @returns Positive integer.
 */
export function resolvePositiveIntOption(
    value: number | undefined,
    fallback: number,
): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1
        ? Math.floor(value)
        : fallback;
}

/**
 * Reuses a caller request ID or creates a new one.
 *
 * @param incomingRequestId - Optional request header value.
 * @param createRequestId - Request ID factory.
 * @returns Request identifier.
 */
export function resolveRequestId(
    incomingRequestId: string | undefined,
    createRequestId: () => string,
): string {
    return incomingRequestId && incomingRequestId.length > 0
        ? incomingRequestId
        : createRequestId();
}
