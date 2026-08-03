/** Screenshot scheduler capacity and retry response configuration. */
export interface RateLimitConfig {
    /** Maximum concurrent screenshot tasks. */
    maxInFlight: number;
    /** Maximum queued screenshot tasks. */
    maxQueue: number;
    /** `Retry-After` response value in seconds. */
    retryAfterSeconds: number;
}
