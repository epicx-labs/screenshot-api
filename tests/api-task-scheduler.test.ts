import { expect, test } from 'vitest';

import { createTaskScheduler } from '../src/api/task-scheduler.js';

/**
 * Creates a deferred promise handle for deterministic async control in tests.
 *
 * @returns Deferred promise and manual resolvers.
 */
function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
} {
    let resolveRef: (value: T) => void = () => undefined;
    let rejectRef: (error: Error) => void = () => undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolveRef = resolve;
        rejectRef = reject;
    });
    return {
        promise,
        resolve: resolveRef,
        reject: rejectRef,
    };
}

test('scheduler runs tasks immediately when capacity is available', async () => {
    const scheduler = createTaskScheduler(2, 2);
    const first = scheduler.scheduleTask(async () => 'a');
    const second = scheduler.scheduleTask(async () => 'b');

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    await expect(first.promise).resolves.toBe('a');
    await expect(second.promise).resolves.toBe('b');
    expect(scheduler.getState()).toEqual({ inFlight: 0, queueDepth: 0 });
});

test('scheduler enqueues tasks when maxInFlight is reached', async () => {
    const scheduler = createTaskScheduler(1, 5);
    const gate = createDeferred<string>();

    const first = scheduler.scheduleTask(async () => gate.promise);
    const second = scheduler.scheduleTask(async () => 'queued');

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(scheduler.getState()).toEqual({ inFlight: 1, queueDepth: 1 });

    gate.resolve('first');
    await expect(first.promise).resolves.toBe('first');
    await expect(second.promise).resolves.toBe('queued');
    expect(scheduler.getState()).toEqual({ inFlight: 0, queueDepth: 0 });
});

test('scheduler rejects new tasks when queue is full', () => {
    const scheduler = createTaskScheduler(1, 1);
    const gate = createDeferred<string>();

    scheduler.scheduleTask(async () => gate.promise);
    scheduler.scheduleTask(async () => 'queued');
    const rejected = scheduler.scheduleTask(async () => 'overflow');

    expect(rejected.accepted).toBe(false);
    expect(rejected.promise).toBeUndefined();
    gate.resolve('done');
});

test('scheduler propagates task errors and recovers capacity', async () => {
    const scheduler = createTaskScheduler(1, 1);
    const failed = scheduler.scheduleTask(async () => {
        throw new Error('boom');
    });

    await expect(failed.promise).rejects.toThrow('boom');
    const next = scheduler.scheduleTask(async () => 'ok');
    await expect(next.promise).resolves.toBe('ok');
});

test('scheduler wraps queued non-Error failures as Error instances', async () => {
    const scheduler = createTaskScheduler(1, 1);
    const gate = createDeferred<void>();

    const first = scheduler.scheduleTask(async () => {
        await gate.promise;
        return 'first';
    });
    const queued = scheduler.scheduleTask(async () => {
        throw 'queued-failure';
    });

    gate.resolve();
    await expect(first.promise).resolves.toBe('first');
    await expect(queued.promise).rejects.toThrow('queued-failure');
});
