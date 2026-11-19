-- CreateEnum
CREATE TYPE "learning_item_kind" AS ENUM ('text', 'video', 'audio', 'pdf', 'image', 'file', 'live');

-- CreateEnum
CREATE TYPE "learning_status" AS ENUM ('in_progress', 'completed');

-- CreateEnum
CREATE TYPE "learning_completion_source" AS ENUM ('manual', 'playback');

-- AlterTable
ALTER TABLE "course_syllabus_items" ADD COLUMN     "content" JSONB,
ADD COLUMN     "is_published" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_required" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kind" "learning_item_kind" NOT NULL DEFAULT 'text',
ADD COLUMN     "resources" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "section_id" UUID;

-- CreateTable
CREATE TABLE "course_sections" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "course_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "title" JSONB,
    "description" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_progress" (
    "student_user_id" UUID NOT NULL,
    "syllabus_item_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "status" "learning_status" NOT NULL,
    "completion_source" "learning_completion_source",
    "first_opened_at" TIMESTAMPTZ(6) NOT NULL,
    "last_opened_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "position_seconds" INTEGER,
    "media_duration_seconds" INTEGER,
    "watched_seconds" INTEGER NOT NULL DEFAULT 0,
    "watched_ranges" JSONB NOT NULL DEFAULT '[]',
    "last_playback_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_progress_pkey" PRIMARY KEY ("student_user_id","syllabus_item_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_course_sections_course_order" ON "course_sections"("course_id", "sort_order");

-- CreateIndex
CREATE INDEX "learning_progress_syllabus_item_id_course_id_idx" ON "learning_progress"("syllabus_item_id", "course_id");

-- CreateIndex
CREATE INDEX "learning_progress_course_id_idx" ON "learning_progress"("course_id");

-- CreateIndex
CREATE INDEX "learning_progress_student_user_id_course_id_last_opened_at_idx" ON "learning_progress"("student_user_id", "course_id", "last_opened_at" DESC);

-- CreateIndex
CREATE INDEX "course_syllabus_items_section_id_idx" ON "course_syllabus_items"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_course_syllabus_items_id_course" ON "course_syllabus_items"("id", "course_id");

-- AddForeignKey
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "course_syllabus_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_syllabus_item_id_course_id_fkey" FOREIGN KEY ("syllabus_item_id", "course_id") REFERENCES "course_syllabus_items"("id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-20 — «My School»: curriculum levels, lesson content
-- and learning progress; roadmap §4q, decisions D-R130..D-R139, ADR-078;
-- master doc section 06). Prisma Migrate keeps this SQL verbatim. Every CHECK
-- is written so that it can never evaluate to NULL (a NULL result would let
-- the row through), and none compares two instants (each may come from a
-- different clock). No existing row changes meaning: every syllabus item
-- stays a published, required text lesson outside any level.
-- ---------------------------------------------------------------------------

-- course_sections
-- The level order swaps inside one transaction, like the syllabus order (ADR-046):
-- the Prisma unique index becomes a deferrable constraint of the same name.
DROP INDEX "uq_course_sections_course_order";
ALTER TABLE "course_sections" ADD CONSTRAINT "uq_course_sections_course_order"
    UNIQUE ("course_id", "sort_order") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "course_sections" ADD CONSTRAINT "ck_course_sections_sort_order_nonnegative"
    CHECK ("sort_order" >= 0);
ALTER TABLE "course_sections" ADD CONSTRAINT "ck_course_sections_title_localized"
    CHECK ("title" IS NULL OR (jsonb_typeof("title") = 'object' AND "title" ? 'ar'));
ALTER TABLE "course_sections" ADD CONSTRAINT "ck_course_sections_description_localized"
    CHECK ("description" IS NULL OR (jsonb_typeof("description") = 'object' AND "description" ? 'ar'));

-- course_syllabus_items
-- The content is an object whose shape follows `kind` (checked in code); the resources a short array.
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "ck_course_syllabus_items_content_object"
    CHECK ("content" IS NULL OR jsonb_typeof("content") = 'object');
ALTER TABLE "course_syllabus_items" ADD CONSTRAINT "ck_course_syllabus_items_resources_array"
    CHECK (jsonb_typeof("resources") = 'array' AND jsonb_array_length("resources") <= 20);

-- learning_progress
-- A completion always says when and how, and only a completion does.
ALTER TABLE "learning_progress" ADD CONSTRAINT "ck_learning_progress_completed_at"
    CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL));
ALTER TABLE "learning_progress" ADD CONSTRAINT "ck_learning_progress_completion_source"
    CHECK (("status" = 'completed') = ("completion_source" IS NOT NULL));
ALTER TABLE "learning_progress" ADD CONSTRAINT "ck_learning_progress_position"
    CHECK ("position_seconds" IS NULL OR "position_seconds" >= 0);
ALTER TABLE "learning_progress" ADD CONSTRAINT "ck_learning_progress_media_duration"
    CHECK ("media_duration_seconds" IS NULL OR "media_duration_seconds" > 0);
-- The played time is never negative and never longer than the media it was measured against.
ALTER TABLE "learning_progress" ADD CONSTRAINT "ck_learning_progress_watched_seconds"
    CHECK ("watched_seconds" >= 0 AND ("media_duration_seconds" IS NULL OR "watched_seconds" <= "media_duration_seconds"));
ALTER TABLE "learning_progress" ADD CONSTRAINT "ck_learning_progress_watched_ranges_array"
    CHECK (jsonb_typeof("watched_ranges") = 'array' AND jsonb_array_length("watched_ranges") <= 200);
