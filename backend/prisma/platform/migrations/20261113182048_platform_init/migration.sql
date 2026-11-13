-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('super_admin', 'support');

-- CreateEnum
CREATE TYPE "platform_user_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "academy_status" AS ENUM ('provisioning', 'active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "domain_kind" AS ENUM ('platform_subdomain', 'custom');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('trial', 'active', 'past_due', 'canceled', 'expired');

-- CreateEnum
CREATE TYPE "probe_outcome" AS ENUM ('ready', 'not_ready', 'unreachable', 'invalid');

-- CreateTable
CREATE TABLE "platform_users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "platform_role" NOT NULL,
    "status" "platform_user_status" NOT NULL DEFAULT 'active',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL DEFAULT uuidv7(),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "user_agent" TEXT,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_platform_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "status" "academy_status" NOT NULL DEFAULT 'provisioning',
    "origin" TEXT,
    "contact_email" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domains" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "academy_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "kind" "domain_kind" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "academy_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "trial_ends_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_health_checks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "academy_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "probe_outcome" NOT NULL,
    "http_status" INTEGER,
    "latency_ms" INTEGER,
    "api_version" TEXT,
    "environment" TEXT,
    "schema_status" TEXT,
    "schema_expected" TEXT,
    "schema_applied" TEXT,
    "reason" TEXT,
    "error" TEXT,
    "triggered_by" UUID,

    CONSTRAINT "academy_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_refresh_tokens_token_hash_key" ON "platform_refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "platform_refresh_tokens_replaced_by_id_key" ON "platform_refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE INDEX "platform_refresh_tokens_user_id_expires_at_idx" ON "platform_refresh_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "platform_refresh_tokens_family_id_idx" ON "platform_refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_actor_platform_user_id_idx" ON "platform_audit_logs"("actor_platform_user_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_entity_type_entity_id_idx" ON "platform_audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "academies_slug_key" ON "academies"("slug");

-- CreateIndex
CREATE INDEX "academies_created_by_idx" ON "academies"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "domains_hostname_key" ON "domains"("hostname");

-- CreateIndex
CREATE INDEX "domains_academy_id_idx" ON "domains"("academy_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE INDEX "subscriptions_academy_id_status_idx" ON "subscriptions"("academy_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "academy_health_checks_academy_id_checked_at_idx" ON "academy_health_checks"("academy_id", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "academy_health_checks_triggered_by_idx" ON "academy_health_checks"("triggered_by");

-- AddForeignKey
ALTER TABLE "platform_refresh_tokens" ADD CONSTRAINT "platform_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_refresh_tokens" ADD CONSTRAINT "platform_refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "platform_refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actor_platform_user_id_fkey" FOREIGN KEY ("actor_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academies" ADD CONSTRAINT "academies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_health_checks" ADD CONSTRAINT "academy_health_checks_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_health_checks" ADD CONSTRAINT "academy_health_checks_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-18-T01, master doc 6.6.2) — objects Prisma cannot
-- express; Prisma Migrate keeps this SQL verbatim. No role names, no
-- extensions, no data. Every CHECK is written so that it can never evaluate
-- to NULL (a NULL CHECK lets the row through): a nullable column is guarded by
-- `col IS NULL OR …`, a JSON key by COALESCE.
-- ---------------------------------------------------------------------------

-- platform_users: one normalized login e-mail, a real name, a sane counter.
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_email_normalized"
    CHECK ("email" = lower(btrim("email")));
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_email_format"
    CHECK (position('@' in "email") > 1);
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_full_name_not_blank"
    CHECK (btrim("full_name") <> '');
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_failed_login_count"
    CHECK ("failed_login_count" >= 0);

-- platform_audit_logs: a named event and object metadata.
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "ck_platform_audit_logs_action_not_blank"
    CHECK (btrim("action") <> '');
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "ck_platform_audit_logs_metadata_object"
    CHECK ("metadata" IS NULL OR jsonb_typeof("metadata") = 'object');

-- academies: the slug rule of deploy/scripts/new-academy-env.mjs, a localized
-- name with a non-empty Arabic string, an https origin (http on loopback only),
-- a normalized contact e-mail, bounded notes, archived_at exactly when archived.
ALTER TABLE "academies" ADD CONSTRAINT "ck_academies_slug_format"
    CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$');
ALTER TABLE "academies" ADD CONSTRAINT "ck_academies_name_localized"
    CHECK (jsonb_typeof("name") = 'object'
           AND COALESCE(jsonb_typeof("name" -> 'ar'), '') = 'string'
           AND COALESCE(btrim("name" ->> 'ar'), '') <> '');
ALTER TABLE "academies" ADD CONSTRAINT "ck_academies_origin_format"
    CHECK ("origin" IS NULL
           OR "origin" ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'
           OR "origin" ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$');
ALTER TABLE "academies" ADD CONSTRAINT "ck_academies_contact_email_normalized"
    CHECK ("contact_email" IS NULL
           OR ("contact_email" = lower(btrim("contact_email"))
               AND position('@' in "contact_email") > 1));
ALTER TABLE "academies" ADD CONSTRAINT "ck_academies_notes_length"
    CHECK ("notes" IS NULL OR char_length("notes") <= 2000);
ALTER TABLE "academies" ADD CONSTRAINT "ck_academies_archived_at"
    CHECK (("status" = 'archived') = ("archived_at" IS NOT NULL));

-- domains: a lower-case hostname with a dot (or localhost); at most one
-- primary domain per academy.
ALTER TABLE "domains" ADD CONSTRAINT "ck_domains_hostname_format"
    CHECK ("hostname" ~ '^[a-z0-9.-]+$'
           AND (position('.' in "hostname") > 0 OR "hostname" = 'localhost'));
CREATE UNIQUE INDEX "uq_domains_academy_primary"
    ON "domains" ("academy_id") WHERE "is_primary";

-- plans: a short machine key, a localized name, object limits.
ALTER TABLE "plans" ADD CONSTRAINT "ck_plans_key_format"
    CHECK ("key" ~ '^[a-z0-9][a-z0-9_-]{0,39}$');
ALTER TABLE "plans" ADD CONSTRAINT "ck_plans_name_localized"
    CHECK (jsonb_typeof("name") = 'object'
           AND COALESCE(jsonb_typeof("name" -> 'ar'), '') = 'string'
           AND COALESCE(btrim("name" ->> 'ar'), '') <> '');
ALTER TABLE "plans" ADD CONSTRAINT "ck_plans_limits_object"
    CHECK (jsonb_typeof("limits") = 'object');

-- subscriptions: ends after it starts; at most one current subscription
-- (trial | active | past_due) per academy.
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_ends_after_start"
    CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at");
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_trial_ends_after_start"
    CHECK ("trial_ends_at" IS NULL OR "trial_ends_at" > "starts_at");
CREATE UNIQUE INDEX "uq_subscriptions_academy_current"
    ON "subscriptions" ("academy_id") WHERE "status" IN ('trial', 'active', 'past_due');

-- academy_health_checks: a non-negative latency, a bounded error text.
ALTER TABLE "academy_health_checks" ADD CONSTRAINT "ck_academy_health_checks_latency"
    CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0);
ALTER TABLE "academy_health_checks" ADD CONSTRAINT "ck_academy_health_checks_error_length"
    CHECK ("error" IS NULL OR char_length("error") <= 500);

-- platform_audit_logs: append-only, exactly like the academy audit_logs
-- (migrations 20261029150949 + 20261029151839). Row-level, so it lets through
-- exactly one kind of update — clearing actor_platform_user_id while every
-- other column stays identical, i.e. the effect of the ON DELETE SET NULL
-- action when a platform user row is deleted. Any other UPDATE, every DELETE
-- and TRUNCATE are rejected.
CREATE FUNCTION platform_audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.actor_platform_user_id IS NOT NULL AND NEW.actor_platform_user_id IS NULL
           AND (to_jsonb(NEW) - 'actor_platform_user_id') = (to_jsonb(OLD) - 'actor_platform_user_id') THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'platform_audit_logs is append-only';
END;
$$;

CREATE TRIGGER "trg_platform_audit_logs_append_only"
    BEFORE UPDATE OR DELETE ON "platform_audit_logs"
    FOR EACH ROW EXECUTE FUNCTION platform_audit_logs_append_only();

CREATE TRIGGER "trg_platform_audit_logs_no_truncate"
    BEFORE TRUNCATE ON "platform_audit_logs"
    FOR EACH STATEMENT EXECUTE FUNCTION platform_audit_logs_append_only();
