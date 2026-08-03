import { defineConfig } from '@playwright/test';

const workers = process.env.CI ? 1 : undefined;

/** Playwright configuration for Docker-backed API contract tests. */
export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '**/*.e2e.spec.ts',
    fullyParallel: false,
    ...(workers === undefined ? {} : { workers }),
    reporter: process.env.CI
        ? [['list'], ['html', { open: 'never' }]]
        : [['list']],
    use: {
        baseURL: process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4010',
    },
});
