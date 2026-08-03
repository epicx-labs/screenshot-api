/**
 * Internal queue item used by the bounded scheduler.
 */
interface QueuedTask {
    /**
     * Task to execute once capacity is available.
     */
    run: () => Promise<unknown>;
    /**
     * Promise resolver for queued task completion.
     */
    resolve: (value: unknown) => void;
    /**
     * Promise rejecter for queued task failure.
     */
    reject: (error: Error) => void;
}

/**
 * Result returned when attempting to schedule work.
 */
export interface ScheduleResult<T> {
    /**
     * Indicates whether the task was accepted by the scheduler.
     */
    accepted: boolean;
    /**
     * Task promise when accepted.
     */
    promise?: Promise<T>;
}

/**
 * Current scheduler state snapshot.
 */
export interface SchedulerState {
    /**
     * Number of actively running tasks.
     */
    inFlight: number;
    /**
     * Number of queued tasks waiting for execution.
     */
    queueDepth: number;
}

/**
 * Scheduler API used by rate-limited routes.
 */
export interface TaskScheduler {
    /**
     * Attempts to enqueue or execute a task immediately.
     */
    scheduleTask: <T>(run: () => Promise<T>) => ScheduleResult<T>;
    /**
     * Returns current in-flight and queue-depth counters.
     */
    getState: () => SchedulerState;
}

/**
 * Creates a bounded task scheduler for API route handlers.
 *
 * @param maxInFlight - Maximum concurrent tasks.
 * @param maxQueue - Maximum queued tasks.
 * @returns A scheduler implementation with queue-state introspection.
 */
export function createTaskScheduler(
    maxInFlight: number,
    maxQueue: number,
): TaskScheduler {
    let inFlight = 0;
    const queue: QueuedTask[] = [];

    /**
     * Flushes one queued task when capacity is available.
     */
    function finishTask(): void {
        inFlight = Math.max(0, inFlight - 1);
        if (queue.length === 0 || inFlight >= maxInFlight) {
            return;
        }
        const next = queue.shift();
        if (!next) {
            return;
        }

        inFlight += 1;
        next.run()
            .then((result) => {
                next.resolve(result);
            })
            .catch((error) => {
                next.reject(
                    error instanceof Error ? error : new Error(String(error)),
                );
            })
            .finally(() => {
                finishTask();
            });
    }

    /**
     * Executes a task immediately and ensures scheduler state is released.
     *
     * @param run - Async task callback.
     * @returns Task result promise.
     */
    function runTask<T>(run: () => Promise<T>): Promise<T> {
        inFlight += 1;
        return run()
            .then((result) => {
                finishTask();
                return result;
            })
            .catch((error) => {
                finishTask();
                throw error;
            });
    }

    /**
     * Attempts to schedule task execution under configured queue limits.
     *
     * @param run - Async task callback.
     * @returns Acceptance state and task promise when accepted.
     */
    function scheduleTask<T>(run: () => Promise<T>): ScheduleResult<T> {
        if (inFlight >= maxInFlight) {
            if (queue.length >= maxQueue) {
                return { accepted: false };
            }

            const promise = new Promise<T>((resolve, reject) => {
                queue.push({
                    run: run as () => Promise<unknown>,
                    resolve: resolve as (value: unknown) => void,
                    reject: reject as (error: Error) => void,
                });
            });

            return { accepted: true, promise };
        }

        return { accepted: true, promise: runTask(run) };
    }

    return {
        scheduleTask,
        getState: () => ({
            inFlight,
            queueDepth: queue.length,
        }),
    };
}
