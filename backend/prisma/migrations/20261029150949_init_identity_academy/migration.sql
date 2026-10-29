-- CreateEnum
CREATE TYPE "locale" AS ENUM ('ar', 'en', 'tr');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('invited', 'pending', 'active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "employee_kind" AS ENUM ('teacher', 'staff');

-- CreateEnum
CREATE TYPE "guardian_relationship" AS ENUM ('father', 'mother', 'sibling', 'legal_guardian', 'other');

-- CreateEnum
CREATE TYPE "token_purpose" AS ENUM ('invitation', 'email_verification', 'password_reset');

-- CreateTable
CREATE TABLE "academy" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "platform_academy_id" UUID,
    "slug" VARCHAR(64) NOT NULL,
    "name" JSONB NOT NULL,
    "logo_url" TEXT,
    "default_locale" "locale" NOT NULL DEFAULT 'ar',
    "timezone" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "contact_email" TEXT,
    "contact_phone" VARCHAR(32),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT,
    "username" VARCHAR(64),
    "phone" VARCHAR(32),
    "password_hash" TEXT,
    "full_name" TEXT NOT NULL,
    "full_name_latin" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "locale" "locale",
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "email_verified_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_count" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" VARCHAR(64) NOT NULL,
    "label" JSONB NOT NULL,
    "description" JSONB,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_default_for_signup" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" VARCHAR(100) NOT NULL,
    "module" VARCHAR(32) NOT NULL,
    "description" JSONB,
    "deprecated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "user_id" UUID NOT NULL,
    "student_number" VARCHAR(32),
    "date_of_birth" DATE,
    "enrolled_on" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "employee_profiles" (
    "user_id" UUID NOT NULL,
    "employee_number" VARCHAR(32),
    "kind" "employee_kind" NOT NULL,
    "job_title" TEXT,
    "specialization" TEXT,
    "bio" JSONB,
    "hired_on" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "guardian_students" (
    "guardian_user_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "relationship" "guardian_relationship" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_students_pkey" PRIMARY KEY ("guardian_user_id","student_user_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
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

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "purpose" "token_purpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "metadata" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_user_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academy_singleton_key" ON "academy"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "academy_platform_academy_id_key" ON "academy"("platform_academy_id");

-- CreateIndex
CREATE UNIQUE INDEX "academy_slug_key" ON "academy"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "role_permissions_permission_key_idx" ON "role_permissions"("permission_key");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "user_roles_assigned_by_idx" ON "user_roles"("assigned_by");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_student_number_key" ON "student_profiles"("student_number");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_employee_number_key" ON "employee_profiles"("employee_number");

-- CreateIndex
CREATE INDEX "employee_profiles_kind_idx" ON "employee_profiles"("kind");

-- CreateIndex
CREATE INDEX "guardian_students_student_user_id_idx" ON "guardian_students"("student_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_expires_at_idx" ON "refresh_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_purpose_idx" ON "verification_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_students" ADD CONSTRAINT "guardian_students_guardian_user_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_students" ADD CONSTRAINT "guardian_students_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (docs/PROJECT_DOCUMENTATION.md 6.6.5 (و) step 3).
-- Objects Prisma cannot express; Prisma Migrate keeps this SQL verbatim.
-- No role names, no extensions, no data.
-- ---------------------------------------------------------------------------

-- academy: exactly one row (singleton is also UNIQUE above)
ALTER TABLE "academy" ADD CONSTRAINT "ck_academy_singleton" CHECK ("singleton");
-- localized text objects carry the reference language `ar` (D1)
ALTER TABLE "academy" ADD CONSTRAINT "ck_academy_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
ALTER TABLE "academy" ADD CONSTRAINT "ck_academy_settings_object"
    CHECK (jsonb_typeof("settings") = 'object');
-- ISO 4217 currency code, chosen per academy
ALTER TABLE "academy" ADD CONSTRAINT "ck_academy_currency_iso4217"
    CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "roles" ADD CONSTRAINT "ck_roles_label_localized"
    CHECK (jsonb_typeof("label") = 'object' AND "label" ? 'ar');

-- users: every account has a unique, normalized login identifier (D13)
ALTER TABLE "users" ADD CONSTRAINT "ck_users_login_identifier"
    CHECK ("email" IS NOT NULL OR "username" IS NOT NULL);
ALTER TABLE "users" ADD CONSTRAINT "ck_users_email_lowercase"
    CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "users" ADD CONSTRAINT "ck_users_username_lowercase"
    CHECK ("username" IS NULL OR "username" = lower("username"));

-- guardian_students: no self-link; at most one primary guardian per student
ALTER TABLE "guardian_students" ADD CONSTRAINT "ck_guardian_students_distinct"
    CHECK ("guardian_user_id" <> "student_user_id");
CREATE UNIQUE INDEX "uq_guardian_students_primary"
    ON "guardian_students" ("student_user_id") WHERE "is_primary";

-- audit_logs: append-only (D5). Statement-level so even empty UPDATE/DELETE
-- statements are rejected; TRUNCATE is covered as well.
CREATE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
CREATE TRIGGER "trg_audit_logs_append_only"
    BEFORE UPDATE OR DELETE OR TRUNCATE ON "audit_logs"
    FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
