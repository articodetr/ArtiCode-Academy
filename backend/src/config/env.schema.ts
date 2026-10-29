import { z } from 'zod';
import { POSTGRES_DEFAULTS, buildPostgresUrl } from './database-url.js';

// Single source of truth for environment variables. Every variable read by the
// application must be declared here so a typo or a missing value fails at boot.

export const NODE_ENVS = ['development', 'test', 'production'] as const;

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Treats an empty assignment (`VAR=`) like an absent variable. */
function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

/** A non-empty string with a default; `VAR=` falls back to the default too. */
function stringWithDefault(defaultValue: string) {
  return z.preprocess(emptyToUndefined, z.string().min(1).default(defaultValue));
}

const portSchema = z.coerce.number().int().min(1).max(65535);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),

    /** HTTP port the server listens on. */
    PORT: portSchema.default(3000),

    /** Global route prefix, without leading or trailing slashes (e.g. "api" or "api/v1"). */
    API_PREFIX: z
      .string()
      .regex(
        /^[a-z0-9-]+(\/[a-z0-9-]+)*$/i,
        'must be a path such as "api" or "api/v1" without leading or trailing slashes',
      )
      .default('api'),

    /** Comma-separated list of browser origins allowed by CORS. */
    CORS_ORIGIN: z.string().default('http://localhost:5173').transform(parseList),

    /** Serve Swagger UI and the OpenAPI document under `<API_PREFIX>/docs`. */
    SWAGGER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    /**
     * PostgreSQL connection string for the APPLICATION role (DML only, KI-024).
     * Optional outside production so the API can boot (and tests can run) without
     * a database; readiness reports it. When absent it is derived from the
     * variables below, which are the ones compose.yaml reads from the repository
     * root .env, so database credentials are declared once (ADR-019).
     */
    DATABASE_URL: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(
          /^postgres(ql)?:\/\/.+/,
          'must be a postgresql:// connection string',
        )
        .optional(),
    ),

    /** Host the runtime connects to; 127.0.0.1 rather than localhost (IPv4 loopback only). */
    DB_HOST: stringWithDefault(POSTGRES_DEFAULTS.host),
    /** Published PostgreSQL port of compose.yaml (the runtime connects to the same one). */
    POSTGRES_PORT: z.preprocess(
      emptyToUndefined,
      portSchema.default(POSTGRES_DEFAULTS.port),
    ),
    POSTGRES_DB: stringWithDefault(POSTGRES_DEFAULTS.database),
    DB_APP_USER: stringWithDefault(POSTGRES_DEFAULTS.appUser),
    /** Password of the application role; without it no URL is derived. */
    DB_APP_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  // The derivation inputs stay out of the validated config: feature code only
  // ever sees DATABASE_URL.
  .transform(
    ({ DB_HOST, POSTGRES_PORT, POSTGRES_DB, DB_APP_USER, DB_APP_PASSWORD, ...env }) => ({
      ...env,
      DATABASE_URL:
        env.DATABASE_URL ??
        (DB_APP_PASSWORD === undefined
          ? undefined
          : buildPostgresUrl({
              user: DB_APP_USER,
              password: DB_APP_PASSWORD,
              host: DB_HOST,
              port: POSTGRES_PORT,
              database: POSTGRES_DB,
            })),
    }),
  )
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'is required when NODE_ENV=production (set it, or DB_APP_PASSWORD to derive it)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
export type NodeEnv = Env['NODE_ENV'];

/**
 * Passed to `ConfigModule.forRoot({ validate })`. Unknown variables are
 * dropped; invalid ones abort startup with a message naming each problem.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}
