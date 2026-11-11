import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // LR-01: a developer's .env may select the real provider; the e2e suites
    // must never mail their fixture addresses. Process variables beat the env
    // files; a suite that needs another transport sets it itself (password-reset).
    env: { MAIL_TRANSPORT: 'none' },
  },
});
