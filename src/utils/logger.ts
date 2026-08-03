export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

function normalizeLogLevel(value: string | undefined): LogLevel {
    if (!value) {
        return 'info';
    }
    const normalized = value.toLowerCase();
    if (normalized in LEVELS) {
        return normalized as LogLevel;
    }
    return 'info';
}

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[minLevel];
}

function serializeValue(value: unknown): unknown {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return value;
}

function serializeData(data: LogPayload | undefined): LogPayload | undefined {
    if (!data) {
        return undefined;
    }
    const result: LogPayload = {};
    for (const [key, value] of Object.entries(data)) {
        result[key] = serializeValue(value);
    }
    return result;
}

export type Logger = {
    debug: (event: string, data?: LogPayload) => void;
    info: (event: string, data?: LogPayload) => void;
    warn: (event: string, data?: LogPayload) => void;
    error: (event: string, data?: LogPayload) => void;
    child: (fields: LogPayload) => Logger;
};

export function createLogger(
    component: string,
    baseFields: LogPayload = {},
): Logger {
    const minLevel = normalizeLogLevel(
        process.env.LOG_LEVEL ?? process.env.CRAWL_LOG_LEVEL,
    );

    const log = (level: LogLevel, event: string, data?: LogPayload): void => {
        if (!shouldLog(level, minLevel)) {
            return;
        }
        const payload: LogPayload = {
            ts: new Date().toISOString(),
            level,
            component,
            event,
            ...baseFields,
        };
        const serialized = serializeData(data);
        if (serialized && Object.keys(serialized).length > 0) {
            payload.data = serialized;
        }
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(payload));
    };

    return {
        debug: (event, data) => log('debug', event, data),
        info: (event, data) => log('info', event, data),
        warn: (event, data) => log('warn', event, data),
        error: (event, data) => log('error', event, data),
        child: (fields) =>
            createLogger(component, { ...baseFields, ...fields }),
    };
}
