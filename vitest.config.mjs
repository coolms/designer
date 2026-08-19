import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // jsdom gives us a DOM for canvas/shell tests without spinning a browser.
        // Visual regression tests (playwright + golden PNGs) land in M3.2.i under
        // tests/visual/ with their own runner; vitest stays unit-only.
        environment: 'jsdom',
        include: ['tests/unit/**/*.test.ts'],
        setupFiles: ['./tests/setup.ts'],
        globals: false,
        clearMocks: true,
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/index.ts', 'src/**/*.d.ts'],
        },
    },
});
