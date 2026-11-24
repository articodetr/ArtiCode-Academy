// PORTAL-04 — reading the Google configuration from the validated environment.
import { googleCallbackPath, googleEnvFrom, googleOAuthConfigOf, googleRedirectProblem, googleRedirectUri, isGoogleConfigured } from './google.config.js';

const BASE = { NODE_ENV: 'development', API_PREFIX: 'api' };
const CLIENT = { GOOGLE_OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'test-only-secret' };

describe('the Google configuration', () => {
  it('is off unless both client values are set', () => {
    expect(isGoogleConfigured({})).toBe(false);
    expect(isGoogleConfigured({ GOOGLE_OAUTH_CLIENT_ID: CLIENT.GOOGLE_OAUTH_CLIENT_ID })).toBe(false);
    expect(isGoogleConfigured({ GOOGLE_OAUTH_CLIENT_SECRET: CLIENT.GOOGLE_OAUTH_CLIENT_SECRET })).toBe(false);
    expect(isGoogleConfigured(CLIENT)).toBe(true);
    expect(googleOAuthConfigOf({ ...BASE, APP_PUBLIC_URL: 'https://academy.example' })).toBeNull();
  });

  it('takes the explicit redirect URI, else derives it from APP_PUBLIC_URL and the API prefix', () => {
    expect(googleCallbackPath('api')).toBe('/api/auth/google/callback');
    expect(googleRedirectUri({ ...BASE, APP_PUBLIC_URL: 'https://academy.example' })).toBe('https://academy.example/api/auth/google/callback');
    expect(googleRedirectUri({ ...BASE, API_PREFIX: 'api/v1', APP_PUBLIC_URL: 'https://academy.example/' })).toBe('https://academy.example/api/v1/auth/google/callback');
    expect(googleRedirectUri({ ...BASE, APP_PUBLIC_URL: 'https://academy.example', GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:5173/api/auth/google/callback' })).toBe(
      'http://localhost:5173/api/auth/google/callback',
    );
    expect(googleRedirectUri(BASE)).toBeNull();
    expect(googleOAuthConfigOf({ ...BASE, ...CLIENT, APP_PUBLIC_URL: 'https://academy.example' })).toEqual({
      clientId: CLIENT.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: CLIENT.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: 'https://academy.example/api/auth/google/callback',
    });
  });

  it('names what is wrong with the redirect URI', () => {
    expect(googleRedirectProblem({ ...BASE, ...CLIENT })).toMatch(/needs a redirect URI/);
    expect(googleRedirectProblem({ ...BASE, ...CLIENT, GOOGLE_OAUTH_REDIRECT_URI: 'relative/path' })).toMatch(/absolute/);
    expect(googleRedirectProblem({ ...BASE, ...CLIENT, GOOGLE_OAUTH_REDIRECT_URI: 'ws://academy.example/cb' })).toMatch(/absolute/);
    expect(googleRedirectProblem({ ...BASE, ...CLIENT, GOOGLE_OAUTH_REDIRECT_URI: 'https://a:b@academy.example/cb' })).toMatch(/credentials/);
    expect(googleRedirectProblem({ ...BASE, ...CLIENT, GOOGLE_OAUTH_REDIRECT_URI: 'https://academy.example/cb#x' })).toMatch(/fragment/);
    const production = { ...BASE, ...CLIENT, NODE_ENV: 'production' };
    expect(googleRedirectProblem({ ...production, GOOGLE_OAUTH_REDIRECT_URI: 'http://academy.example/cb' })).toMatch(/https/);
    for (const local of ['http://localhost:8080/api/auth/google/callback', 'http://127.0.0.1:3000/cb', 'http://[::1]:3000/cb', 'https://academy.example/cb']) {
      expect(googleRedirectProblem({ ...production, GOOGLE_OAUTH_REDIRECT_URI: local }), local).toBeNull();
    }
  });

  it('reads the keys from a ConfigService-like getter, empty values as absent', () => {
    const values: Record<string, unknown> = { NODE_ENV: 'test', API_PREFIX: 'api', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: '', APP_PUBLIC_URL: 42 };
    expect(googleEnvFrom({ get: (key) => values[key] })).toEqual({
      NODE_ENV: 'test',
      API_PREFIX: 'api',
      APP_PUBLIC_URL: undefined,
      GOOGLE_OAUTH_CLIENT_ID: 'id',
      GOOGLE_OAUTH_CLIENT_SECRET: undefined,
      GOOGLE_OAUTH_REDIRECT_URI: undefined,
    });
  });
});
