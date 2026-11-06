-- CreateEnum
CREATE TYPE "delivery_mode" AS ENUM ('in_person', 'live_online', 'recorded', 'hybrid');

-- CreateEnum
CREATE TYPE "lesson_status" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'absent', 'late', 'excused');

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "class_id" UUID NOT NULL,
    "syllabus_item_id" UUID,
    "schedule_id" UUID,
    "room_id" UUID,
    "teacher_user_id" UUID,
    "title" JSONB NOT NULL,
    "description" JSONB,
    "delivery_mode" "delivery_mode" NOT NULL DEFAULT 'in_person',
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "lesson_status" NOT NULL DEFAULT 'scheduled',
    "meeting_url" TEXT,
    "cancellation_reason" TEXT,
    "attendance_taken_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "lesson_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL,
    "minutes_late" SMALLINT,
    "note" TEXT,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("lesson_id","student_user_id")
);

-- CreateIndex
CREATE INDEX "lessons_class_id_starts_at_idx" ON "lessons"("class_id", "starts_at");

-- CreateIndex
CREATE INDEX "lessons_teacher_user_id_starts_at_idx" ON "lessons"("teacher_user_id", "starts_at");

-- CreateIndex
CREATE INDEX "lessons_room_id_starts_at_idx" ON "lessons"("room_id", "starts_at");

-- CreateIndex
CREATE INDEX "lessons_status_starts_at_idx" ON "lessons"("status", "starts_at");

-- CreateIndex
CREATE INDEX "lessons_syllabus_item_id_idx" ON "lessons"("syllabus_item_id");

-- CreateIndex
CREATE INDEX "lessons_schedule_id_idx" ON "lessons"("schedule_id");

-- CreateIndex
CREATE INDEX "lessons_created_by_idx" ON "lessons"("created_by");

-- CreateIndex
CREATE INDEX "attendance_records_student_user_id_idx" ON "attendance_records"("student_user_id");

-- CreateIndex
CREATE INDEX "attendance_records_recorded_by_idx" ON "attendance_records"("recorded_by");

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_syllabus_item_id_fkey" FOREIGN KEY ("syllabus_item_id") REFERENCES "course_syllabus_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "class_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-06-T01 — roadmap §4f.2/§4f.7 D-R33/D-R34; master doc
-- section 06). Objects Prisma cannot express; Prisma Migrate keeps this SQL
-- verbatim. No role names, no data, no extension: `btree_gist` has existed
-- since 20261104144352_mod07_rooms_class_schedules (CH-0092).
-- ---------------------------------------------------------------------------

-- lessons
ALTER TABLE "lessons" ADD CONSTRAINT "ck_lessons_title_localized"
    CHECK (jsonb_typeof("title") = 'object' AND "title" ? 'ar');
ALTER TABLE "lessons" ADD CONSTRAINT "ck_lessons_description_localized"
    CHECK ("description" IS NULL OR (jsonb_typeof("description") = 'object' AND "description" ? 'ar'));
ALTER TABLE "lessons" ADD CONSTRAINT "ck_lessons_times"
    CHECK ("ends_at" > "starts_at");
ALTER TABLE "lessons" ADD CONSTRAINT "ck_lessons_meeting_url_https"
    CHECK ("meeting_url" IS NULL OR "meeting_url" LIKE 'https://%');

-- No room and no teacher holds two lessons at once: two lessons that are not
-- cancelled and whose instants overlap (half-open [starts_at, ends_at) —
-- back-to-back lessons are fine) cannot share a room, nor a teacher (D-R34),
-- whatever their classes. SQLSTATE 23P01 names the constraint, which the
-- lessons service maps to `lesson_conflict { kind: room|teacher }` (T02).
ALTER TABLE "lessons" ADD CONSTRAINT "ex_lessons_room"
    EXCLUDE USING gist (
        "room_id" WITH =,
        tstzrange("starts_at", "ends_at") WITH &&
    ) WHERE ("room_id" IS NOT NULL AND "status" <> 'cancelled');
ALTER TABLE "lessons" ADD CONSTRAINT "ex_lessons_teacher"
    EXCLUDE USING gist (
        "teacher_user_id" WITH =,
        tstzrange("starts_at", "ends_at") WITH &&
    ) WHERE ("teacher_user_id" IS NOT NULL AND "status" <> 'cancelled');

-- attendance_records: minutes late are positive and belong to `late` only.
ALTER TABLE "attendance_records" ADD CONSTRAINT "ck_attendance_records_minutes_late_positive"
    CHECK ("minutes_late" IS NULL OR "minutes_late" > 0);
ALTER TABLE "attendance_records" ADD CONSTRAINT "ck_attendance_records_minutes_late_only_late"
    CHECK ("minutes_late" IS NULL OR "status" = 'late');
