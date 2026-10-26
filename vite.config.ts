/// <reference types="vitest" />
/// <reference types="vite/client" />
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [ tsconfigPaths() ],
    test: {
        coverage: {
            include: [ 'src/**/*.{js,jsx,ts,tsx}' ],
            reporter: [ 'text', 'json-summary', 'lcov' ],
            clean: false
        },
        environment: 'jsdom',
        restoreMocks: true
    }
});
