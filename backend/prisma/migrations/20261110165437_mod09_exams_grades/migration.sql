-- CreateEnum
CREATE TYPE "exam_type" AS ENUM ('quiz', 'midterm', 'final', 'project', 'oral', 'practice', 'other');

-- CreateEnum
CREATE TYPE "exam_status" AS ENUM ('draft', 'scheduled', 'published');

-- CreateEnum
CREATE TYPE "exam_result_status" AS ENUM ('scored', 'absent', 'excused');

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "class_id" UUID NOT NULL,
    "lesson_id" UUID,
    "title" JSONB NOT NULL,
    "description" JSONB,
    "type" "exam_type" NOT NULL,
    "status" "exam_status" NOT NULL DEFAULT 'draft',
    "scheduled_at" TIMESTAMPTZ(6),
    "duration_minutes" SMALLINT,
    "max_score" DECIMAL(6,2) NOT NULL,
    "pass_score" DECIMAL(6,2),
    "weight" DECIMAL(5,2),
    "published_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_results" (
    "exam_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status" "exam_result_status" NOT NULL,
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_results_pkey" PRIMARY KEY ("exam_id","student_user_id")
);

-- CreateTable
CREATE TABLE "grade_schemes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_scheme_bands" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "scheme_id" UUID NOT NULL,
    "min_percent" DECIMAL(5,2) NOT NULL,
    "label" JSONB NOT NULL,
    "letter" VARCHAR(4),
    "is_pass" BOOLEAN NOT NULL,

    CONSTRAINT "grade_scheme_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_grades" (
    "enrollment_id" UUID NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "scheme_id" UUID NOT NULL,
    "band_label" JSONB NOT NULL,
    "band_letter" VARCHAR(4),
    "is_pass" BOOLEAN NOT NULL,
    "breakdown" JSONB NOT NULL,
    "finalized_by" UUID,
    "finalized_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_grades_pkey" PRIMARY KEY ("enrollment_id")
);

-- CreateIndex
CREATE INDEX "exams_class_id_scheduled_at_idx" ON "exams"("class_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "exams_status_scheduled_at_idx" ON "exams"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "exams_lesson_id_idx" ON "exams"("lesson_id");

-- CreateIndex
CREATE INDEX "exams_created_by_idx" ON "exams"("created_by");

-- CreateIndex
CREATE INDEX "exam_results_student_user_id_idx" ON "exam_results"("student_user_id");

-- CreateIndex
CREATE INDEX "exam_results_recorded_by_idx" ON "exam_results"("recorded_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_grade_scheme_bands_min" ON "grade_scheme_bands"("scheme_id", "min_percent");

-- CreateIndex
CREATE INDEX "final_grades_scheme_id_idx" ON "final_grades"("scheme_id");

-- CreateIndex
CREATE INDEX "final_grades_finalized_by_idx" ON "final_grades"("finalized_by");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_scheme_bands" ADD CONSTRAINT "grade_scheme_bands_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "grade_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grades" ADD CONSTRAINT "final_grades_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grades" ADD CONSTRAINT "final_grades_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "grade_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grades" ADD CONSTRAINT "final_grades_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-09-T01 — roadmap §4h.2; owner decisions D-R42..D-R49,
-- CH-0123; master doc section 06). CHECKs and the partial unique index Prisma
-- cannot express; Prisma Migrate keeps this SQL verbatim. No role names, no
-- data, no extension. A result's `score <= exams.max_score` spans two tables
-- and stays a service rule (T04).
-- ---------------------------------------------------------------------------

-- exams
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_title_localized"
    CHECK (jsonb_typeof("title") = 'object' AND "title" ? 'ar');
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_description_localized"
    CHECK ("description" IS NULL OR (jsonb_typeof("description") = 'object' AND "description" ? 'ar'));
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_max_score_positive"
    CHECK ("max_score" > 0);
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_pass_score_range"
    CHECK ("pass_score" IS NULL OR ("pass_score" >= 0 AND "pass_score" <= "max_score"));
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_weight_non_negative"
    CHECK ("weight" IS NULL OR "weight" >= 0);
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_duration_range"
    CHECK ("duration_minutes" IS NULL OR ("duration_minutes" >= 1 AND "duration_minutes" <= 720));
-- The results are published exactly when the exam is (D-R47).
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_published_at"
    CHECK (("published_at" IS NOT NULL) = ("status" = 'published'));

-- exam_results
ALTER TABLE "exam_results" ADD CONSTRAINT "ck_exam_results_score_non_negative"
    CHECK ("score" IS NULL OR "score" >= 0);
-- A score exists exactly for a scored result; absent and excused carry none.
ALTER TABLE "exam_results" ADD CONSTRAINT "ck_exam_results_score_only_scored"
    CHECK (("score" IS NOT NULL) = ("status" = 'scored'));

-- grade_schemes
ALTER TABLE "grade_schemes" ADD CONSTRAINT "ck_grade_schemes_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
ALTER TABLE "grade_schemes" ADD CONSTRAINT "ck_grade_schemes_default_active"
    CHECK (NOT "is_default" OR "is_active");
-- At most one default scheme (D-R46); the API keeps exactly one once a scheme exists.
CREATE UNIQUE INDEX "uq_grade_schemes_default"
    ON "grade_schemes" ("is_default") WHERE "is_default";

-- grade_scheme_bands
ALTER TABLE "grade_scheme_bands" ADD CONSTRAINT "ck_grade_scheme_bands_min_percent_range"
    CHECK ("min_percent" >= 0 AND "min_percent" <= 100);
ALTER TABLE "grade_scheme_bands" ADD CONSTRAINT "ck_grade_scheme_bands_label_localized"
    CHECK (jsonb_typeof("label") = 'object' AND "label" ? 'ar');
ALTER TABLE "grade_scheme_bands" ADD CONSTRAINT "ck_grade_scheme_bands_letter_trimmed"
    CHECK ("letter" IS NULL OR ("letter" = btrim("letter") AND "letter" <> ''));

-- final_grades
ALTER TABLE "final_grades" ADD CONSTRAINT "ck_final_grades_percent_range"
    CHECK ("percent" >= 0 AND "percent" <= 100);
ALTER TABLE "final_grades" ADD CONSTRAINT "ck_final_grades_band_label_localized"
    CHECK (jsonb_typeof("band_label") = 'object' AND "band_label" ? 'ar');
ALTER TABLE "final_grades" ADD CONSTRAINT "ck_final_grades_band_letter_trimmed"
    CHECK ("band_letter" IS NULL OR ("band_letter" = btrim("band_letter") AND "band_letter" <> ''));
ALTER TABLE "final_grades" ADD CONSTRAINT "ck_final_grades_breakdown_array"
    CHECK (jsonb_typeof("breakdown") = 'array');
