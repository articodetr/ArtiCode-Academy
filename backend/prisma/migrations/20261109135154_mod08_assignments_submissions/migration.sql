-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('draft', 'open', 'closed', 'grading', 'graded');

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('submitted', 'graded', 'returned');

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "class_id" UUID NOT NULL,
    "lesson_id" UUID,
    "title" JSONB NOT NULL,
    "instructions" JSONB,
    "max_score" DECIMAL(6,2) NOT NULL,
    "weight" DECIMAL(5,2),
    "status" "assignment_status" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "allow_late" BOOLEAN NOT NULL DEFAULT false,
    "late_penalty_percent" DECIMAL(5,2),
    "max_attempts" SMALLINT NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "assignment_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "attempt_no" SMALLINT NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "text_answer" TEXT,
    "link_url" TEXT,
    "status" "submission_status" NOT NULL DEFAULT 'submitted',
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "graded_by" UUID,
    "graded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignments_class_id_due_at_idx" ON "assignments"("class_id", "due_at");

-- CreateIndex
CREATE INDEX "assignments_status_due_at_idx" ON "assignments"("status", "due_at");

-- CreateIndex
CREATE INDEX "assignments_lesson_id_idx" ON "assignments"("lesson_id");

-- CreateIndex
CREATE INDEX "assignments_created_by_idx" ON "assignments"("created_by");

-- CreateIndex
CREATE INDEX "assignment_submissions_student_user_id_idx" ON "assignment_submissions"("student_user_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_graded_by_idx" ON "assignment_submissions"("graded_by");

-- CreateIndex
CREATE INDEX "assignment_submissions_assignment_id_status_idx" ON "assignment_submissions"("assignment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_assignment_submissions_attempt" ON "assignment_submissions"("assignment_id", "student_user_id", "attempt_no");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-08-T01 — roadmap §4g.2; owner decisions D-R35..D-R40,
-- CH-0114; master doc section 06). CHECKs Prisma cannot express; Prisma
-- Migrate keeps this SQL verbatim. No role names, no data, no extension.
-- `score <= max_score` spans two tables and stays a service rule (T03).
-- ---------------------------------------------------------------------------

-- assignments
ALTER TABLE "assignments" ADD CONSTRAINT "ck_assignments_title_localized"
    CHECK (jsonb_typeof("title") = 'object' AND "title" ? 'ar');
ALTER TABLE "assignments" ADD CONSTRAINT "ck_assignments_instructions_localized"
    CHECK ("instructions" IS NULL OR (jsonb_typeof("instructions") = 'object' AND "instructions" ? 'ar'));
ALTER TABLE "assignments" ADD CONSTRAINT "ck_assignments_max_score_positive"
    CHECK ("max_score" > 0);
ALTER TABLE "assignments" ADD CONSTRAINT "ck_assignments_weight_non_negative"
    CHECK ("weight" IS NULL OR "weight" >= 0);
ALTER TABLE "assignments" ADD CONSTRAINT "ck_assignments_late_penalty_range"
    CHECK ("late_penalty_percent" IS NULL OR ("late_penalty_percent" >= 0 AND "late_penalty_percent" <= 100));
-- A late penalty means nothing unless late submissions are allowed (D-R38).
ALTER TABLE "assignments" ADD CONSTRAINT "ck_assignments_late_penalty_only_allow_late"
    CHECK ("late_penalty_percent" IS NULL OR "allow_late");
ALTER TABLE "assignments" ADD CONSTRAINT "ck_assignments_max_attempts_positive"
    CHECK ("max_attempts" >= 1);
-- Every published state carries the instant it was published (D-R37).
ALTER TABLE "assignments" ADD CONSTRAINT "ck_assignments_published_at_for_non_draft"
    CHECK ("status" = 'draft' OR "published_at" IS NOT NULL);

-- assignment_submissions
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "ck_assignment_submissions_attempt_no_positive"
    CHECK ("attempt_no" >= 1);
-- A submission carries text and/or a link (D-R35 — no files before MOD-15).
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "ck_assignment_submissions_content"
    CHECK ("text_answer" IS NOT NULL OR "link_url" IS NOT NULL);
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "ck_assignment_submissions_link_url_https"
    CHECK ("link_url" IS NULL OR "link_url" LIKE 'https://%');
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "ck_assignment_submissions_score_non_negative"
    CHECK ("score" IS NULL OR "score" >= 0);
-- A score exists exactly when the submission is graded (D-R39).
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "ck_assignment_submissions_score_only_graded"
    CHECK (("score" IS NOT NULL) = ("status" = 'graded'));
-- Graded and returned submissions carry the review instant; a fresh one does not.
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "ck_assignment_submissions_reviewed_at"
    CHECK (("graded_at" IS NOT NULL) = ("status" <> 'submitted'));
-- Returning work for rework always says why (D-R39).
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "ck_assignment_submissions_feedback_on_return"
    CHECK ("status" <> 'returned' OR "feedback" IS NOT NULL);
