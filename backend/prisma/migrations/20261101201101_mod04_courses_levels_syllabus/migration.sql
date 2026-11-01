-- CreateEnum
CREATE TYPE "course_status" AS ENUM ('draft', 'published', 'archived');

-- CreateTable
CREATE TABLE "levels" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" VARCHAR(16) NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "sort_order" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" VARCHAR(32) NOT NULL,
    "name" JSONB NOT NULL,
    "summary" JSONB,
    "description" JSONB,
    "level_id" UUID,
    "status" "course_status" NOT NULL DEFAULT 'draft',
    "duration_hours" DECIMAL(6,1),
    "sessions_count" SMALLINT,
    "min_age" SMALLINT,
    "max_age" SMALLINT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_syllabus_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "course_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB,
    "estimated_minutes" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_syllabus_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "levels_code_key" ON "levels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_levels_sort_order" ON "levels"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_status_idx" ON "courses"("status");

-- CreateIndex
CREATE INDEX "courses_level_id_idx" ON "courses"("level_id");

-- CreateIndex
CREATE INDEX "courses_created_by_idx" ON "courses"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_course_syllabus_items_course_order" ON "course_syllabus_items"("course_id", "sort_order");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "course_syllabus_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-04-T01 — roadmap §4c.2; master doc section 06).
-- Objects Prisma cannot express; Prisma Migrate keeps this SQL verbatim.
-- No role names, no extensions, no data.
-- ---------------------------------------------------------------------------

-- Reordering swaps sort_order values inside one transaction, so both order
-- uniques become DEFERRABLE constraints (same names as the Prisma indexes).
-- Note: a deferrable constraint cannot be an ON CONFLICT arbiter.
DROP INDEX "uq_levels_sort_order";
ALTER TABLE "levels" ADD CONSTRAINT "uq_levels_sort_order"
    UNIQUE ("sort_order") DEFERRABLE INITIALLY DEFERRED;
DROP INDEX "uq_course_syllabus_items_course_order";
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "uq_course_syllabus_items_course_order"
    UNIQUE ("course_id", "sort_order") DEFERRABLE INITIALLY DEFERRED;

-- levels
ALTER TABLE "levels" ADD CONSTRAINT "ck_levels_code_trimmed"
    CHECK ("code" = btrim("code") AND "code" <> '');
ALTER TABLE "levels" ADD CONSTRAINT "ck_levels_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
ALTER TABLE "levels" ADD CONSTRAINT "ck_levels_description_localized"
    CHECK ("description" IS NULL OR (jsonb_typeof("description") = 'object' AND "description" ? 'ar'));
ALTER TABLE "levels" ADD CONSTRAINT "ck_levels_sort_order_nonnegative"
    CHECK ("sort_order" >= 0);

-- courses
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_code_trimmed"
    CHECK ("code" = btrim("code") AND "code" <> '');
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_summary_localized"
    CHECK ("summary" IS NULL OR (jsonb_typeof("summary") = 'object' AND "summary" ? 'ar'));
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_description_localized"
    CHECK ("description" IS NULL OR (jsonb_typeof("description") = 'object' AND "description" ? 'ar'));
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_duration_positive"
    CHECK ("duration_hours" IS NULL OR "duration_hours" > 0);
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_sessions_positive"
    CHECK ("sessions_count" IS NULL OR "sessions_count" > 0);
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_age_range"
    CHECK (("min_age" IS NULL OR "min_age" >= 0)
       AND ("max_age" IS NULL OR "max_age" >= 0)
       AND ("min_age" IS NULL OR "max_age" IS NULL OR "max_age" >= "min_age"));

-- course_syllabus_items
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "ck_course_syllabus_items_title_localized"
    CHECK (jsonb_typeof("title") = 'object' AND "title" ? 'ar');
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "ck_course_syllabus_items_description_localized"
    CHECK ("description" IS NULL OR (jsonb_typeof("description") = 'object' AND "description" ? 'ar'));
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "ck_course_syllabus_items_sort_order_nonnegative"
    CHECK ("sort_order" >= 0);
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "ck_course_syllabus_items_minutes_positive"
    CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" > 0);
