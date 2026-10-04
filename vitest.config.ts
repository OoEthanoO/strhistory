import { defineConfig } from 'vitest/config';

// Tests of the Alex's Atlas modules in packages/ (the site's own tests run with
// `node --test`, see .github/workflows/ci.yml). DOM tests opt in per file with
// `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/pipeline/tests/**/*.test.{js,mjs,ts}'],
    environment: 'node',
    testTimeout: 30000,
  },
});
