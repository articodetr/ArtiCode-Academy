/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL for API calls. Empty (default) means same origin, which the Vite
   * dev proxy forwards to the backend. Set it when the API lives elsewhere.
   */
  readonly VITE_API_BASE_URL?: string
}
