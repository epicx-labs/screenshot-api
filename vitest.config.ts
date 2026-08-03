import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: [
                'src/api/app.ts',
                'src/api/task-scheduler.ts',
                'src/modules/screenshots/**/*.ts',
            ],
        },
    },
});
