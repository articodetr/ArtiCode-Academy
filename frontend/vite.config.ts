import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/ — the `test` block is read by Vitest only (MOD-03-T16, S1-R03).
export default defineConfig(({ mode }) => {
  // Empty prefix: read every variable so server-only settings never need VITE_.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Same-origin /api/* calls are forwarded to the NestJS server in development.
        '/api': {
          target: env.API_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    test: {
      // Component tests run against jsdom; no browser is involved.
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // Every test starts with fresh spies and the original globals (fetch is stubbed per test).
      restoreMocks: true,
      unstubGlobals: true,
      // Multi-step Ant Design screens (wizard, drawer) take 2–5 s in jsdom and exceed
      // the 5 s default when the machine is busy (MOD-03-T11); 15 s keeps them stable.
      testTimeout: 15_000,
    },
  }
})
