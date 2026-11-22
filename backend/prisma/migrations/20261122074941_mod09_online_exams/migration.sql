-- CreateEnum
CREATE TYPE "exam_delivery" AS ENUM ('manual', 'online');

-- CreateEnum
CREATE TYPE "exam_results_release" AS ENUM ('on_publish', 'on_submit');

-- CreateEnum
CREATE TYPE "exam_result_source" AS ENUM ('manual', 'online');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('single_choice', 'true_false');

-- CreateEnum
CREATE TYPE "question_status" AS ENUM ('draft', 'ready', 'archived');

-- CreateEnum
CREATE TYPE "question_difficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "exam_attempt_status" AS ENUM ('in_progress', 'submitted', 'timed_out');

-- AlterTable
ALTER TABLE "exam_results" ADD COLUMN     "source" "exam_result_source" NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "attempts_allowed" SMALLINT NOT NULL DEFAULT 1,
ADD COLUMN     "closes_at" TIMESTAMPTZ(6),
ADD COLUMN     "delivery" "exam_delivery" NOT NULL DEFAULT 'manual',
ADD COLUMN     "results_release" "exam_results_release" NOT NULL DEFAULT 'on_publish',
ADD COLUMN     "reveal_answers" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "question_banks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "course_id" UUID,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "bank_id" UUID NOT NULL,
    "type" "question_type" NOT NULL,
    "status" "question_status" NOT NULL DEFAULT 'draft',
    "prompt" JSONB NOT NULL,
    "explanation" JSONB,
    "points" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "correct_boolean" BOOLEAN,
    "difficulty" "question_difficulty",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "question_id" UUID NOT NULL,
    "text" JSONB NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "exam_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,
    "snapshot" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "exam_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "attempt_no" SMALLINT NOT NULL,
    "status" "exam_attempt_status" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "score" DECIMAL(6,2),
    "max_score" DECIMAL(6,2) NOT NULL,
    "question_count" SMALLINT NOT NULL,
    "correct_count" SMALLINT,
    "graded_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_answers" (
    "attempt_id" UUID NOT NULL,
    "exam_question_id" UUID NOT NULL,
    "response" JSONB NOT NULL,
    "is_correct" BOOLEAN,
    "points_awarded" DECIMAL(6,2),
    "answered_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_answers_pkey" PRIMARY KEY ("attempt_id","exam_question_id")
);

-- CreateIndex
CREATE INDEX "question_banks_course_id_idx" ON "question_banks"("course_id");

-- CreateIndex
CREATE INDEX "question_banks_created_by_idx" ON "question_banks"("created_by");

-- CreateIndex
CREATE INDEX "questions_bank_id_status_idx" ON "questions"("bank_id", "status");

-- CreateIndex
CREATE INDEX "questions_created_by_idx" ON "questions"("created_by");

-- CreateIndex
CREATE INDEX "questions_tags_idx" ON "questions" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "uq_question_options_order" ON "question_options"("question_id", "sort_order");

-- CreateIndex
CREATE INDEX "exam_questions_question_id_idx" ON "exam_questions"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_exam_questions_question" ON "exam_questions"("exam_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_exam_questions_order" ON "exam_questions"("exam_id", "sort_order");

-- CreateIndex
CREATE INDEX "exam_attempts_student_user_id_idx" ON "exam_attempts"("student_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_exam_attempts_no" ON "exam_attempts"("exam_id", "student_user_id", "attempt_no");

-- CreateIndex
CREATE INDEX "exam_answers_exam_question_id_idx" ON "exam_answers"("exam_question_id");

-- AddForeignKey
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "question_banks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_exam_question_id_fkey" FOREIGN KEY ("exam_question_id") REFERENCES "exam_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-09 phase 2 — online exams; roadmap §4r, decisions
-- D-R150..D-R166; master doc section 06). CHECKs and the two partial indexes
-- Prisma cannot express; Prisma Migrate keeps this SQL verbatim. No role
-- names, no data, no extension.
--
-- Additive only: the columns added above carry constant defaults, so every
-- exam and every result that existed before is `manual` and reads as before
-- (PostgreSQL adds such a column without rewriting the table). Every CHECK is
-- written so that it cannot evaluate to NULL. No CHECK compares two instants
-- written by different clocks: `started_at` and `expires_at` are written
-- together by the application.
-- Rules that span rows or tables stay service rules under a row lock: exactly
-- one correct option, the points of an exam summing to its maximum score, the
-- attempt limit, the window, a score within the exam's maximum.
-- ---------------------------------------------------------------------------

-- exams: the online settings (D-R150, D-R152, D-R153, D-R156, D-R157)
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_attempts_allowed_range"
    CHECK ("attempts_allowed" BETWEEN 1 AND 20);
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_closes_after_opens"
    CHECK ("closes_at" IS NULL OR "scheduled_at" IS NULL OR "closes_at" > "scheduled_at");
-- A manual exam carries no online setting, so nothing of this phase can change
-- how an exam of the first phase behaves.
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_manual_settings"
    CHECK ("delivery" = 'online'
        OR ("closes_at" IS NULL AND "attempts_allowed" = 1 AND "results_release" = 'on_publish' AND NOT "reveal_answers"));
-- An online exam the learners can see has its whole window and its time limit.
ALTER TABLE "exams" ADD CONSTRAINT "ck_exams_online_window"
    CHECK ("delivery" = 'manual' OR "status" = 'draft'
        OR ("scheduled_at" IS NOT NULL AND "closes_at" IS NOT NULL AND "duration_minutes" IS NOT NULL));

-- exam_results: an online result is the score of a finished attempt (D-R160)
ALTER TABLE "exam_results" ADD CONSTRAINT "ck_exam_results_online_scored"
    CHECK ("source" = 'manual' OR "status" = 'scored');

-- question_banks
ALTER TABLE "question_banks" ADD CONSTRAINT "ck_question_banks_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
ALTER TABLE "question_banks" ADD CONSTRAINT "ck_question_banks_description_localized"
    CHECK ("description" IS NULL OR (jsonb_typeof("description") = 'object' AND "description" ? 'ar'));

-- questions
ALTER TABLE "questions" ADD CONSTRAINT "ck_questions_prompt_localized"
    CHECK (jsonb_typeof("prompt") = 'object' AND "prompt" ? 'ar');
ALTER TABLE "questions" ADD CONSTRAINT "ck_questions_explanation_localized"
    CHECK ("explanation" IS NULL OR (jsonb_typeof("explanation") = 'object' AND "explanation" ? 'ar'));
ALTER TABLE "questions" ADD CONSTRAINT "ck_questions_points_positive"
    CHECK ("points" > 0);
-- The boolean key belongs to true/false questions only, and a ready one has it.
ALTER TABLE "questions" ADD CONSTRAINT "ck_questions_boolean_key_type"
    CHECK ("type" = 'true_false' OR "correct_boolean" IS NULL);
ALTER TABLE "questions" ADD CONSTRAINT "ck_questions_ready_true_false_key"
    CHECK ("status" <> 'ready' OR "type" <> 'true_false' OR "correct_boolean" IS NOT NULL);
ALTER TABLE "questions" ADD CONSTRAINT "ck_questions_tags_limit"
    CHECK ("tags" IS NOT NULL AND cardinality("tags") <= 10);

-- question_options
ALTER TABLE "question_options" ADD CONSTRAINT "ck_question_options_text_localized"
    CHECK (jsonb_typeof("text") = 'object' AND "text" ? 'ar');
ALTER TABLE "question_options" ADD CONSTRAINT "ck_question_options_sort_order"
    CHECK ("sort_order" >= 0);

-- exam_questions
ALTER TABLE "exam_questions" ADD CONSTRAINT "ck_exam_questions_points_positive"
    CHECK ("points" > 0);
ALTER TABLE "exam_questions" ADD CONSTRAINT "ck_exam_questions_sort_order"
    CHECK ("sort_order" >= 0);
-- The frozen copy (D-R158) is an object naming the question's type, prompt and options, or absent.
ALTER TABLE "exam_questions" ADD CONSTRAINT "ck_exam_questions_snapshot_shape"
    CHECK ("snapshot" IS NULL
        OR (jsonb_typeof("snapshot") = 'object' AND "snapshot" ? 'type' AND "snapshot" ? 'prompt' AND "snapshot" ? 'options'));

-- exam_attempts
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_attempt_no_range"
    CHECK ("attempt_no" BETWEEN 1 AND 20);
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_expires_after_start"
    CHECK ("expires_at" > "started_at");
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_max_score_positive"
    CHECK ("max_score" > 0);
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_question_count_positive"
    CHECK ("question_count" >= 1);
-- A finished attempt (submitted or timed out) is graded; one in progress carries no result.
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_submitted_at"
    CHECK (("status" = 'in_progress') = ("submitted_at" IS NULL));
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_score_when_finished"
    CHECK (("status" = 'in_progress') = ("score" IS NULL));
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_correct_count_when_finished"
    CHECK (("status" = 'in_progress') = ("correct_count" IS NULL));
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_graded_at_when_finished"
    CHECK (("status" = 'in_progress') = ("graded_at" IS NULL));
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_score_range"
    CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= "max_score"));
ALTER TABLE "exam_attempts" ADD CONSTRAINT "ck_exam_attempts_correct_count_range"
    CHECK ("correct_count" IS NULL OR ("correct_count" >= 0 AND "correct_count" <= "question_count"));
-- At most one attempt in progress per student and exam: two simultaneous
-- «start» requests cannot both insert (D-R153) — the loser reads the winner's row.
CREATE UNIQUE INDEX "uq_exam_attempts_in_progress"
    ON "exam_attempts" ("exam_id", "student_user_id") WHERE "status" = 'in_progress';
-- The sweeper's lookup of attempts whose time is up (D-R154).
CREATE INDEX "ix_exam_attempts_expiry"
    ON "exam_attempts" ("expires_at") WHERE "status" = 'in_progress';

-- exam_answers
ALTER TABLE "exam_answers" ADD CONSTRAINT "ck_exam_answers_response_object"
    CHECK (jsonb_typeof("response") = 'object');
ALTER TABLE "exam_answers" ADD CONSTRAINT "ck_exam_answers_graded_together"
    CHECK (("is_correct" IS NULL) = ("points_awarded" IS NULL));
ALTER TABLE "exam_answers" ADD CONSTRAINT "ck_exam_answers_points_non_negative"
    CHECK ("points_awarded" IS NULL OR "points_awarded" >= 0);
