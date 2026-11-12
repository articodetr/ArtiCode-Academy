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
    // Every suite talks to a real database and hashes passwords with Argon2:
    // vitest's 5 s per test and 10 s per hook left no margin on a busy machine
    // (KI-040), and since MOD-12-T03 the writer routes also write their
    // notifications. A test that states its own timeout keeps it.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
