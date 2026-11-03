-- CreateEnum
CREATE TYPE "class_status" AS ENUM ('planned', 'open', 'running', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "class_teacher_role" AS ENUM ('lead', 'assistant');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('pending', 'active', 'completed', 'withdrawn', 'cancelled');

-- CreateEnum
CREATE TYPE "enrollment_source" AS ENUM ('admin', 'self', 'import', 'transfer');

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "course_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" JSONB NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "status" "class_status" NOT NULL DEFAULT 'planned',
    "starts_on" DATE,
    "ends_on" DATE,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_teachers" (
    "class_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "role" "class_teacher_role" NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,

    CONSTRAINT "class_teachers_pkey" PRIMARY KEY ("class_id","teacher_user_id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "class_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status" "enrollment_status" NOT NULL,
    "source" "enrollment_source" NOT NULL DEFAULT 'admin',
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),
    "withdrawal_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "classes_code_key" ON "classes"("code");

-- CreateIndex
CREATE INDEX "classes_course_id_idx" ON "classes"("course_id");

-- CreateIndex
CREATE INDEX "classes_status_idx" ON "classes"("status");

-- CreateIndex
CREATE INDEX "classes_created_by_idx" ON "classes"("created_by");

-- CreateIndex
CREATE INDEX "class_teachers_teacher_user_id_idx" ON "class_teachers"("teacher_user_id");

-- CreateIndex
CREATE INDEX "class_teachers_assigned_by_idx" ON "class_teachers"("assigned_by");

-- CreateIndex
CREATE INDEX "enrollments_student_user_id_idx" ON "enrollments"("student_user_id");

-- CreateIndex
CREATE INDEX "enrollments_status_idx" ON "enrollments"("status");

-- CreateIndex
CREATE INDEX "enrollments_created_by_idx" ON "enrollments"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_enrollments_class_student" ON "enrollments"("class_id", "student_user_id");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-05-T01 — roadmap §4d.2; master doc section 06).
-- Objects Prisma cannot express; Prisma Migrate keeps this SQL verbatim.
-- No role names, no extensions, no data.
-- ---------------------------------------------------------------------------

-- classes
ALTER TABLE "classes" ADD CONSTRAINT "ck_classes_code_trimmed"
    CHECK ("code" = btrim("code") AND "code" <> '');
ALTER TABLE "classes" ADD CONSTRAINT "ck_classes_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
ALTER TABLE "classes" ADD CONSTRAINT "ck_classes_capacity_positive"
    CHECK ("capacity" > 0);
ALTER TABLE "classes" ADD CONSTRAINT "ck_classes_dates"
    CHECK ("starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on");

-- class_teachers: at most one lead teacher per class (any number of assistants).
CREATE UNIQUE INDEX "uq_class_teachers_lead"
    ON "class_teachers" ("class_id") WHERE "role" = 'lead';
