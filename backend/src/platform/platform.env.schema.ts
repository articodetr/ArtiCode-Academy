// MOD-18-T02 — environment of the PLATFORM application (D-R97, D-R100;
// roadmap §4m). Single source of truth for every variable the platform process
// reads, in the style of src/config/env.schema.ts (which stays the academy
// API's own schema and is not read here).
//
// Reuse trick: the parsed object ALSO carries the generic keys the shared HTTP
// setup reads — PORT, API_PREFIX, CORS_ORIGIN, NODE_ENV, SWAGGER_ENABLED and
// TRUST_PROXY (configureApp() in src/app.setup.ts, OriginGuard in
// src/auth/origin.guard.ts) — derived from the PLATFORM_* variables, so both
// run unchanged on the platform app. An academy PORT / CORS_ORIGIN / JWT_* in
// the same env files is never read: the schema strips every key it does not
// declare, and ConfigService answers from the validated object first.
//
// The platform database is reached only through PLATFORM_DATABASE_URL or the
// PLATFORM_DB_* role variables — never through DATABASE_URL (the academy one).
import { z } from 'zod';
import {
  NODE_ENVS,
  emptyToUndefined,
  parseList,
  parseTrustProxy,
  portSchema,
  stringWithDefault,
} from '../config/env.schema.js';
import { PLATFORM_DEFAULTS, POSTGRES_DEFAULTS, buildPostgresUrl } from '../config/database-url.js';

const booleanFlag = z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional());

/** An integer in [min, max] with a default; `VAR=` falls back to the default too. */
function intWithDefault(min: number, max: number, defaultValue: number) {
  return z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(defaultValue));
}

export const platformEnvSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),

    /** HTTP port of the platform API (the academy API keeps PORT, 3000). */
    PLATFORM_PORT: z.preprocess(emptyToUndefined, portSchema.default(3100)),

    /** Global route prefix, as the academy API's API_PREFIX. */
    API_PREFIX: z
      .string()
      .regex(
        /^[a-z0-9-]+(\/[a-z0-9-]+)*$/i,
        'must be a path such as "api" or "api/v1" without leading or trailing slashes',
      )
      .default('api'),

    /**
     * Comma-separated browser origins of the Super Admin frontend: CORS and the
     * OriginGuard allowlist of the platform (never the academy CORS_ORIGIN).
     */
    PLATFORM_CORS_ORIGIN: z
      .preprocess(emptyToUndefined, z.string().default('http://localhost:5174'))
      .transform(parseList),

    /** Swagger UI under `<API_PREFIX>/docs`: on outside production, off in production unless `true`. */
    SWAGGER_ENABLED: booleanFlag,

    /** Express `trust proxy` — same format and the same refusal of `true` as the academy API (parseTrustProxy()). */
    TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().optional()).transform((raw, ctx) => {
      const parsed = parseTrustProxy(raw);
      if ('error' in parsed) {
        ctx.addIssue({ code: 'custom', message: parsed.error });
        return z.NEVER;
      }
      return parsed.value;
    }),

    /**
     * Connection string of the platform APPLICATION role (`platform_app`, DML
     * only). Optional outside production; when absent it is derived from the
     * variables below (the ones docker/postgres/initdb/20-platform.sh and the
     * root .env use).
     */
    PLATFORM_DATABASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().regex(/^postgres(ql)?:\/\/.+/, 'must be a postgresql:// connection string').optional(),
    ),
    /** Shared with the academy API: the PostgreSQL server of development. */
    DB_HOST: stringWithDefault(POSTGRES_DEFAULTS.host),
    POSTGRES_PORT: z.preprocess(emptyToUndefined, portSchema.default(POSTGRES_DEFAULTS.port)),
    PLATFORM_DB_NAME: stringWithDefault(PLATFORM_DEFAULTS.database),
    PLATFORM_DB_APP_USER: stringWithDefault(PLATFORM_DEFAULTS.appUser),
    /** Password of the platform application role; without it no URL is derived. */
    PLATFORM_DB_APP_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),

    // --- Platform authentication (D-R100) ----------------------------------
    /**
     * HS256 secret of the platform access tokens (at least 32 characters).
     * Required in production; otherwise PlatformTokenService generates an
     * ephemeral one at boot. Must differ from the academy JWT_SECRET.
     */
    PLATFORM_JWT_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(32, 'must be at least 32 characters').optional(),
    ),
    /** Read only to refuse a PLATFORM_JWT_SECRET equal to it; never kept in the config. */
    JWT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
    /** `iss` claim of every platform access token. */
    PLATFORM_JWT_ISSUER: stringWithDefault('articode-platform'),
    /** `aud` claim of every platform access token. */
    PLATFORM_JWT_AUDIENCE: stringWithDefault('articode-platform-api'),
    /** Access token lifetime in seconds (1 to 60 minutes). */
    PLATFORM_JWT_ACCESS_TTL_SECONDS: intWithDefault(60, 3600, 900),
    /** Refresh token lifetime in days (cookie `pla_refresh`, T03). */
    PLATFORM_REFRESH_TTL_DAYS: intWithDefault(1, 90, 7),
    /** Absolute lifetime of a refresh-token family from sign-in; at least PLATFORM_REFRESH_TTL_DAYS. */
    PLATFORM_REFRESH_FAMILY_MAX_DAYS: intWithDefault(1, 365, 14),
    /** `Secure` attribute of the platform refresh cookie; defaults to true in production. */
    PLATFORM_COOKIE_SECURE: booleanFlag,
    /** Failed logins (per platform account) before a temporary lock. */
    PLATFORM_LOCKOUT_THRESHOLD: intWithDefault(3, 20, 5),
    /** Duration of the temporary lock, in minutes. */
    PLATFORM_LOCKOUT_MINUTES: intWithDefault(1, 1440, 15),

    // --- Fleet probe (D-R103, T05) -----------------------------------------
    /** Upper bound of one probe request to an academy's public endpoint. */
    PLATFORM_PROBE_TIMEOUT_MS: intWithDefault(500, 30_000, 5000),
    /** Pause between two rounds of the periodic probe service. */
    PLATFORM_PROBE_INTERVAL_SECONDS: intWithDefault(30, 86_400, 300),
  })
  // Checked on the raw input: the academy secret is never kept in the config.
  .superRefine((env, ctx) => {
    if (env.PLATFORM_JWT_SECRET !== undefined && env.PLATFORM_JWT_SECRET === env.JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLATFORM_JWT_SECRET'],
        message: 'must differ from JWT_SECRET: a platform token and an academy token must never share a key',
      });
    }
  })
  // The derivation inputs and the academy secret stay out of the config; the
  // generic keys of the shared setup are added.
  .transform(
    ({
      DB_HOST,
      POSTGRES_PORT,
      PLATFORM_DB_NAME,
      PLATFORM_DB_APP_USER,
      PLATFORM_DB_APP_PASSWORD,
      JWT_SECRET: _academySecret,
      SWAGGER_ENABLED,
      PLATFORM_COOKIE_SECURE,
      ...env
    }) => ({
      ...env,
      PLATFORM_DATABASE_URL:
        env.PLATFORM_DATABASE_URL ??
        (PLATFORM_DB_APP_PASSWORD === undefined
          ? undefined
          : buildPostgresUrl({
              user: PLATFORM_DB_APP_USER,
              password: PLATFORM_DB_APP_PASSWORD,
              host: DB_HOST,
              port: POSTGRES_PORT,
              database: PLATFORM_DB_NAME,
            })),
      PLATFORM_COOKIE_SECURE:
        PLATFORM_COOKIE_SECURE === undefined ? env.NODE_ENV === 'production' : PLATFORM_COOKIE_SECURE === 'true',
      // Generic keys read by configureApp() and OriginGuard.
      PORT: env.PLATFORM_PORT,
      CORS_ORIGIN: env.PLATFORM_CORS_ORIGIN,
      SWAGGER_ENABLED: SWAGGER_ENABLED === undefined ? env.NODE_ENV !== 'production' : SWAGGER_ENABLED === 'true',
    }),
  )
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.PLATFORM_DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLATFORM_DATABASE_URL'],
        message: 'is required when NODE_ENV=production (set it, or PLATFORM_DB_APP_PASSWORD to derive it)',
      });
    }
    if (env.NODE_ENV === 'production' && !env.PLATFORM_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLATFORM_JWT_SECRET'],
        message: 'is required when NODE_ENV=production (at least 32 random characters)',
      });
    }
    if (env.PLATFORM_REFRESH_FAMILY_MAX_DAYS < env.PLATFORM_REFRESH_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLATFORM_REFRESH_FAMILY_MAX_DAYS'],
        message: `must be at least PLATFORM_REFRESH_TTL_DAYS (${env.PLATFORM_REFRESH_TTL_DAYS}): a session cannot be capped below the lifetime of a single refresh token`,
      });
    }
  });

export type PlatformEnv = z.infer<typeof platformEnvSchema>;

/**
 * Passed to `ConfigModule.forRoot({ validate })` of PlatformAppModule. Unknown
 * variables are dropped; invalid ones abort startup with a message naming
 * each problem (never a value).
 */
export function validatePlatformEnv(config: Record<string, unknown>): PlatformEnv {
  const result = platformEnvSchema.safeParse(config);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid platform environment configuration: ${problems}`);
  }
  return result.data;
}
