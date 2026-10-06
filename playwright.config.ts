import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './e2e/specs',
    testMatch: ['**/*.spec.ts'],
    timeout: 120_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    outputDir: 'temp/e2e-results'
})
