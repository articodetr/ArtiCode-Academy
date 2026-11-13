import { isIP } from 'node:net';
import { z } from 'zod';
import { POSTGRES_DEFAULTS, buildPostgresUrl } from './database-url.js';

// Single source of truth for environment variables. Every variable read by the
// application must be declared here so a typo or a missing value fails at boot.
// The platform application (MOD-18) has its own schema,
// src/platform/platform.env.schema.ts, built from the exported helpers below.

export const NODE_ENVS = ['development', 'test', 'production'] as const;
/** Outgoing-mail transports (src/mail/); `log` is for development only, `resend` is the real provider (LR-01, D-R74). */
export const MAIL_TRANSPORTS = ['none', 'log', 'resend'] as const;

/** A bare address: one @, no spaces or angle brackets, a dot in the domain. */
const MAIL_ADDRESS = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

/** `MAIL_FROM`: `address` or `Display Name <address>` (the forms Resend accepts). */
export function isMailbox(value: string): boolean {
  const named = /^([^<>]*\S)\s*<([^<>]+)>$/.exec(value);
  return named ? MAIL_ADDRESS.test(named[2]!) : MAIL_ADDRESS.test(value);
}

export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Treats an empty assignment (`VAR=`) like an absent variable. */
export function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

/** A non-empty string with a default; `VAR=` falls back to the default too. */
export function stringWithDefault(defaultValue: string) {
  return z.preprocess(emptyToUndefined, z.string().min(1).default(defaultValue));
}

export const portSchema = z.coerce.number().int().min(1).max(65535);

/** Address keywords Express accepts in `trust proxy` besides IPs and CIDR ranges. */
export const TRUST_PROXY_KEYWORDS = ['loopback', 'linklocal', 'uniquelocal'] as const;
/** Express `trust proxy` value: off, a number of proxies, or the trusted proxy addresses. */
export type TrustProxy = false | number | string[];
const MAX_PROXY_HOPS = 10;

function isProxyAddress(entry: string): boolean {
  if ((TRUST_PROXY_KEYWORDS as readonly string[]).includes(entry)) return true;
  const [address, bits, extra] = entry.split('/');
  if (extra !== undefined || !address) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (version === 4 ? 32 : 128);
}

/**
 * TRUST_PROXY (MOD-01-H01): absent, empty, `false` or `0` → off; `1`–`10` → that
 * many proxies in front of the API; otherwise a comma-separated list of proxy
 * addresses, CIDR ranges and TRUST_PROXY_KEYWORDS. `true` is refused: it trusts
 * every X-Forwarded-For header, so any client could choose its own IP.
 */
export function parseTrustProxy(raw: string | undefined): { value: TrustProxy } | { error: string } {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '' || value === 'false' || value === '0') return { value: false };
  if (value === 'true') {
    return {
      error:
        '"true" trusts every X-Forwarded-For header, so any client could choose its own IP; give the number of proxies in front of the API (e.g. 1) or their addresses',
    };
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops <= MAX_PROXY_HOPS ? { value: hops } : { error: `must be at most ${MAX_PROXY_HOPS} proxies` };
  }
  const entries = parseList(value);
  const invalid = entries.filter((entry) => !isProxyAddress(entry));
  if (entries.length === 0 || invalid.length > 0) {
    return {
      error: `must be a number of proxies, or IP addresses, CIDR ranges and ${TRUST_PROXY_KEYWORDS.join('/')} separated by commas (invalid: ${invalid.join(', ') || value})`,
    };
  }
  return { value: entries };
}

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

    /**
     * Serve Swagger UI and the OpenAPI document under `<API_PREFIX>/docs`.
     * Defaults to true outside production and false in production (MOD-01-H04,
     * SEC-R-05): the full API map is published there only on an explicit `true`.
     */
    SWAGGER_ENABLED: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),

    /**
     * Express `trust proxy` (MOD-01-H01, KI-030): which reverse proxies may set
     * X-Forwarded-For / X-Forwarded-Proto, so that `req.ip` (audit log, refresh
     * tokens, rate limiting) and `req.protocol` (OriginGuard) describe the real
     * client. Off by default — set it when the API runs behind nginx/Caddy
     * (e.g. `1`). Format and the refusal of `true`: parseTrustProxy().
     */
    TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().optional()).transform((raw, ctx) => {
      const parsed = parseTrustProxy(raw);
      if ('error' in parsed) {
        ctx.addIssue({ code: 'custom', message: parsed.error });
        return z.NEVER;
      }
      return parsed.value;
    }),

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

    // --- Authentication (MOD-01) -------------------------------------------
    /**
     * HS256 secret for access tokens (at least 32 characters). Required in
     * production; otherwise TokenService generates an ephemeral secret at boot
     * (every restart invalidates outstanding access tokens, refresh still works).
     */
    JWT_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(32, 'must be at least 32 characters').optional(),
    ),
    /** `iss` claim checked on every access token. */
    JWT_ISSUER: stringWithDefault('articode-academy'),
    /** `aud` claim checked on every access token. */
    JWT_AUDIENCE: stringWithDefault('articode-academy-api'),
    /** Access token lifetime in seconds (1 to 60 minutes). */
    JWT_ACCESS_TTL_SECONDS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(60).max(3600).default(900),
    ),
    /** Refresh token lifetime in days; each rotation issues a fresh token with a full lifetime. */
    AUTH_REFRESH_TTL_DAYS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(90).default(14),
    ),
    /**
     * Absolute lifetime of a refresh-token family in days, counted from sign-in
     * (MOD-01-H03, owner decision: 30). Rotation never extends a session past it;
     * the user signs in again. Must be at least AUTH_REFRESH_TTL_DAYS.
     */
    AUTH_REFRESH_FAMILY_MAX_DAYS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(365).default(30),
    ),
    /** `Secure` attribute of the refresh cookie. Defaults to true in production, false elsewhere. */
    AUTH_COOKIE_SECURE: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
    /** Failed logins (per account) before a temporary lock. */
    AUTH_LOCKOUT_THRESHOLD: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(3).max(20).default(5),
    ),
    /** Duration of the temporary account lock, in minutes. */
    AUTH_LOCKOUT_MINUTES: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(1440).default(15),
    ),

    // --- Account lifecycle (MOD-03: invitations, password reset) ------------
    /** Lifetime of an invitation token in hours (1 h – 30 days; owner decision D-R02: 48). */
    AUTH_INVITATION_TTL_HOURS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(720).default(48),
    ),
    /** Lifetime of a password-reset token in minutes (5 min – 24 h; D-R02: 30). */
    AUTH_PASSWORD_RESET_TTL_MINUTES: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(5).max(1440).default(30),
    ),
    /** Lifetime of an e-mail verification token in hours (1 h – 30 days; LR-01-T02, D-R78: 48). */
    AUTH_EMAIL_VERIFICATION_TTL_HOURS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(720).default(48),
    ),
    /**
     * Public "forgot my password" route. Off until an e-mail channel exists
     * (D-R01: invitation and reset links are handed over manually for now).
     */
    AUTH_SELF_SERVICE_RESET_ENABLED: z.preprocess(
      emptyToUndefined,
      z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true'),
    ),
    /**
     * Public base URL of the web app (e.g. https://academy.example), reserved
     * for links in e-mails once a mail channel exists. http(s) only, no default;
     * a trailing slash is removed.
     */
    APP_PUBLIC_URL: z.preprocess(
      emptyToUndefined,
      z
        .url({ protocol: /^https?$/ })
        .transform((value) => value.replace(/\/+$/, ''))
        .optional(),
    ),

    // --- Mail (MOD-03-T03, owner decision D-R08) ---------------------------
    /**
     * How outgoing e-mail is handled. `none` (default): nothing is sent and
     * nothing but the message kind is logged — invitation and reset tokens
     * reach the authorized admin once, in the API response (D-R01). `log`
     * (development only): also writes each message with its link to the
     * server log; refused in production below. `resend` (LR-01, D-R74): sends
     * through the Resend API and needs RESEND_API_KEY, MAIL_FROM and
     * APP_PUBLIC_URL.
     */
    MAIL_TRANSPORT: z.preprocess(emptyToUndefined, z.enum(MAIL_TRANSPORTS).default('none')),
    /**
     * Resend API key (LR-01, D-R74/D-R75) — required when MAIL_TRANSPORT=resend,
     * ignored otherwise. A secret: never committed, logged or documented by value.
     */
    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().regex(/^\S+$/, 'must not contain spaces').optional()),
    /**
     * Sender of every e-mail, `address` or `Display Name <address>`, on a domain
     * verified at the provider — required when MAIL_TRANSPORT=resend.
     */
    MAIL_FROM: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .transform((value) => value.trim())
        .refine(isMailbox, 'must be an address or "Display Name <address>"')
        .optional(),
    ),
    /** Optional Reply-To address of every e-mail (e.g. the academy office). */
    MAIL_REPLY_TO: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .transform((value) => value.trim().toLowerCase())
        .refine((value) => MAIL_ADDRESS.test(value), 'must be an e-mail address')
        .optional(),
    ),
  })
  // The derivation inputs stay out of the validated config: feature code only
  // ever sees DATABASE_URL.
  .transform(
    ({
      DB_HOST,
      POSTGRES_PORT,
      POSTGRES_DB,
      DB_APP_USER,
      DB_APP_PASSWORD,
      AUTH_COOKIE_SECURE,
      SWAGGER_ENABLED,
      ...env
    }) => ({
      ...env,
      SWAGGER_ENABLED: SWAGGER_ENABLED === undefined ? env.NODE_ENV !== 'production' : SWAGGER_ENABLED === 'true',
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
      AUTH_COOKIE_SECURE:
        AUTH_COOKIE_SECURE === undefined
          ? env.NODE_ENV === 'production'
          : AUTH_COOKIE_SECURE === 'true',
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
    if (env.NODE_ENV === 'production' && !env.JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'is required when NODE_ENV=production (at least 32 random characters)',
      });
    }
    // D-R08 / ADR-031: development conveniences never reach production, and a
    // self-service reset without a transport that reaches the user is a lie.
    if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message:
          '"log" is a development-only transport and is refused when NODE_ENV=production (use "resend", or "none" to hand the links over manually)',
      });
    }
    if (env.AUTH_REFRESH_FAMILY_MAX_DAYS < env.AUTH_REFRESH_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_REFRESH_FAMILY_MAX_DAYS'],
        message: `must be at least AUTH_REFRESH_TTL_DAYS (${env.AUTH_REFRESH_TTL_DAYS}): a session cannot be capped below the lifetime of a single refresh token`,
      });
    }
    // LR-01 (D-R75): a real transport needs its key, a sender, and absolute
    // links — a root-relative link in an e-mail leads nowhere.
    if (env.MAIL_TRANSPORT === 'resend') {
      for (const key of ['RESEND_API_KEY', 'MAIL_FROM', 'APP_PUBLIC_URL'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required when MAIL_TRANSPORT=resend' });
      }
    }
    if (env.AUTH_SELF_SERVICE_RESET_ENABLED && env.MAIL_TRANSPORT === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SELF_SERVICE_RESET_ENABLED'],
        message: 'cannot be true while MAIL_TRANSPORT=none: the public password-reset route needs a mail transport that reaches the user',
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
