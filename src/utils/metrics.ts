/** In-memory metrics used for structured request telemetry. */
export interface MetricsRecorder {
    /** Increments a named counter. */
    increment: (name: string, by?: number) => number;
    /** Stores the latest named gauge value. */
    gauge: (name: string, value: number) => void;
    /** Starts a timer and returns its duration reader. */
    time: (name: string) => () => number;
}

/**
 * Creates an in-memory metrics recorder.
 *
 * @returns Metrics recorder scoped to one application instance.
 */
export function createMetrics(): MetricsRecorder {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const timingsMs: Record<string, number> = {};

    return {
        increment(name, by = 1) {
            const next = (counters[name] ?? 0) + by;
            counters[name] = next;
            return next;
        },
        gauge(name, value) {
            gauges[name] = value;
        },
        time(name) {
            const startedAt = Date.now();
            return () => {
                const durationMs = Date.now() - startedAt;
                timingsMs[name] = (timingsMs[name] ?? 0) + durationMs;
                return durationMs;
            };
        },
    };
}
