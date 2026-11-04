-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" VARCHAR(16) NOT NULL,
    "name" JSONB NOT NULL,
    "address" JSONB,
    "phone" VARCHAR(32),
    "timezone" TEXT,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-02-T05, O8 — roadmap §4b.5/§4b.9; master doc section 06).
-- Objects Prisma cannot express; Prisma Migrate keeps this SQL verbatim.
-- No role names, no extensions, no data.
-- ---------------------------------------------------------------------------

ALTER TABLE "branches" ADD CONSTRAINT "ck_branches_code_trimmed"
    CHECK ("code" = btrim("code") AND "code" <> '');
ALTER TABLE "branches" ADD CONSTRAINT "ck_branches_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
ALTER TABLE "branches" ADD CONSTRAINT "ck_branches_address_localized"
    CHECK ("address" IS NULL OR (jsonb_typeof("address") = 'object' AND "address" ? 'ar'));
-- A main branch is an active one.
ALTER TABLE "branches" ADD CONSTRAINT "ck_branches_main_active"
    CHECK (NOT "is_main" OR "is_active");

-- At most one main branch (zero is allowed: a one-site academy needs no branch).
CREATE UNIQUE INDEX "uq_branches_main"
    ON "branches" ("is_main") WHERE "is_main";
