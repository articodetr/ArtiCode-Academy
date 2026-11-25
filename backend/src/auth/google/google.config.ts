// PORTAL-04 — the configuration of Google sign-in, read from the validated
// environment (env.schema.ts). Google is OFF unless both GOOGLE_OAUTH_CLIENT_ID
// and GOOGLE_OAUTH_CLIENT_SECRET are set; the redirect URI is
// GOOGLE_OAUTH_REDIRECT_URI, else `${APP_PUBLIC_URL}/<API_PREFIX>/auth/google/callback`.
// Pure: env.schema.ts uses `googleRedirectProblem()` for its boot check, the
// academy's public branding (API-205) and the Google routes use
// `googleOAuthConfigOf()`.

/** DI token of the Google configuration (`GoogleOAuthConfig`, or null when Google sign-in is off). */
export const GOOGLE_OAUTH_CONFIG = Symbol('GOOGLE_OAUTH_CONFIG');

/** The environment keys this file reads (a subset of `Env`). */
export interface GoogleEnvInput {
  NODE_ENV: string;
  API_PREFIX: string;
  APP_PUBLIC_URL?: string | undefined;
  GOOGLE_OAUTH_CLIENT_ID?: string | undefined;
  GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined;
  GOOGLE_OAUTH_REDIRECT_URI?: string | undefined;
}

/** What the Google routes need once Google is configured. The secret never leaves the server. */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** The exact `redirect_uri` registered in the Google Cloud Console (authorization request AND token exchange). */
  redirectUri: string;
}

/** Path of the callback under the API prefix (`/api/auth/google/callback` by default). */
export function googleCallbackPath(apiPrefix: string): string {
  return `/${apiPrefix}/auth/google/callback`;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True when both the client id and the client secret are set (Google sign-in is on). */
export function isGoogleConfigured(env: Pick<GoogleEnvInput, 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET'>): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
}

/** The redirect URI Google sends the browser back to: the explicit one, else derived from APP_PUBLIC_URL; null when neither exists. */
export function googleRedirectUri(env: GoogleEnvInput): string | null {
  if (env.GOOGLE_OAUTH_REDIRECT_URI) return env.GOOGLE_OAUTH_REDIRECT_URI;
  if (env.APP_PUBLIC_URL) return `${env.APP_PUBLIC_URL.replace(/\/+$/, '')}${googleCallbackPath(env.API_PREFIX)}`;
  return null;
}

/**
 * Why the effective redirect URI cannot be used, or null when it can: it must
 * be an absolute http(s) URL without credentials or fragment, and — in
 * production — https unless the host is a loopback name (a local trial on
 * http://localhost). Only called when Google is configured.
 */
export function googleRedirectProblem(env: GoogleEnvInput): string | null {
  const uri = googleRedirectUri(env);
  if (!uri) {
    return 'Google sign-in needs a redirect URI: set GOOGLE_OAUTH_REDIRECT_URI, or APP_PUBLIC_URL to derive it';
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return 'must be an absolute http(s) URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'must be an absolute http(s) URL';
  if (url.username || url.password) return 'must not carry credentials';
  if (url.hash) return 'must not carry a fragment';
  if (env.NODE_ENV === 'production' && url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    return 'must use https when NODE_ENV=production (http is accepted for localhost only)';
  }
  return null;
}

/** The configuration of Google sign-in, or null when it is off. Assumes the environment passed the boot check. */
export function googleOAuthConfigOf(env: GoogleEnvInput): GoogleOAuthConfig | null {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
  const redirectUri = googleRedirectUri(env);
  if (!redirectUri) return null;
  return { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, redirectUri };
}

/** The keys a Nest ConfigService answers for the functions above. */
const GOOGLE_ENV_KEYS = [
  'NODE_ENV',
  'API_PREFIX',
  'APP_PUBLIC_URL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
] as const;

/** Reads the Google keys from anything with a `get(key)` (the validated ConfigService). */
export function googleEnvFrom(config: { get(key: string): unknown }): GoogleEnvInput {
  const out: Record<string, string | undefined> = {};
  for (const key of GOOGLE_ENV_KEYS) {
    const value = config.get(key);
    out[key] = typeof value === 'string' && value.length > 0 ? value : undefined;
  }
  return {
    NODE_ENV: out['NODE_ENV'] ?? 'development',
    API_PREFIX: out['API_PREFIX'] ?? 'api',
    APP_PUBLIC_URL: out['APP_PUBLIC_URL'],
    GOOGLE_OAUTH_CLIENT_ID: out['GOOGLE_OAUTH_CLIENT_ID'],
    GOOGLE_OAUTH_CLIENT_SECRET: out['GOOGLE_OAUTH_CLIENT_SECRET'],
    GOOGLE_OAUTH_REDIRECT_URI: out['GOOGLE_OAUTH_REDIRECT_URI'],
  };
}
