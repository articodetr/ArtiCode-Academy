-- CreateEnum
CREATE TYPE "room_kind" AS ENUM ('classroom', 'lab', 'hall', 'virtual');

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "branch_id" UUID,
    "code" VARCHAR(16) NOT NULL,
    "name" JSONB,
    "capacity" SMALLINT,
    "kind" "room_kind" NOT NULL DEFAULT 'classroom',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedules" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "class_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "room_id" UUID,
    "teacher_user_id" UUID,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_rooms_branch_code" ON "rooms"("branch_id", "code");

-- CreateIndex
CREATE INDEX "class_schedules_class_id_idx" ON "class_schedules"("class_id");

-- CreateIndex
CREATE INDEX "class_schedules_room_id_weekday_idx" ON "class_schedules"("room_id", "weekday");

-- CreateIndex
CREATE INDEX "class_schedules_teacher_user_id_weekday_idx" ON "class_schedules"("teacher_user_id", "weekday");

-- CreateIndex
CREATE INDEX "class_schedules_created_by_idx" ON "class_schedules"("created_by");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-07-T01, O9 — roadmap §4e.2/§4e.8; master doc section 06).
-- Objects Prisma cannot express; Prisma Migrate keeps this SQL verbatim.
-- No role names, no data. One extension: btree_gist (D-R25) — a trusted
-- extension, so the database owner (the migrator role) may create it.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- rooms
ALTER TABLE "rooms" ADD CONSTRAINT "ck_rooms_code_trimmed"
    CHECK ("code" = btrim("code") AND "code" <> '');
ALTER TABLE "rooms" ADD CONSTRAINT "ck_rooms_name_localized"
    CHECK ("name" IS NULL OR (jsonb_typeof("name") = 'object' AND "name" ? 'ar'));
ALTER TABLE "rooms" ADD CONSTRAINT "ck_rooms_capacity_positive"
    CHECK ("capacity" IS NULL OR "capacity" > 0);

-- A room code is unique inside its branch, and rooms without a branch share
-- one namespace: the Prisma unique index becomes NULLS NOT DISTINCT (same name).
DROP INDEX "uq_rooms_branch_code";
CREATE UNIQUE INDEX "uq_rooms_branch_code"
    ON "rooms" ("branch_id", "code") NULLS NOT DISTINCT;

-- class_schedules
ALTER TABLE "class_schedules" ADD CONSTRAINT "ck_class_schedules_weekday"
    CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "class_schedules" ADD CONSTRAINT "ck_class_schedules_times"
    CHECK ("end_time" > "start_time");
ALTER TABLE "class_schedules" ADD CONSTRAINT "ck_class_schedules_effective"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- No room and no teacher is booked twice: two slots on the same weekday whose
-- times overlap (half-open [start, end) — adjacent slots are fine) and whose
-- effective date ranges overlap (inclusive; NULL end = unbounded) cannot share
-- a room, nor a teacher (D-R25). The times sit on a fixed date because tsrange
-- needs timestamps. SQLSTATE 23P01 names the constraint, which the service
-- maps to `schedule_conflict { kind: room|teacher }` (T03).
ALTER TABLE "class_schedules" ADD CONSTRAINT "ex_class_schedules_room"
    EXCLUDE USING gist (
        "room_id" WITH =,
        "weekday" WITH =,
        tsrange(DATE '2000-01-01' + "start_time", DATE '2000-01-01' + "end_time") WITH &&,
        daterange("effective_from", "effective_to", '[]') WITH &&
    ) WHERE ("room_id" IS NOT NULL);
ALTER TABLE "class_schedules" ADD CONSTRAINT "ex_class_schedules_teacher"
    EXCLUDE USING gist (
        "teacher_user_id" WITH =,
        "weekday" WITH =,
        tsrange(DATE '2000-01-01' + "start_time", DATE '2000-01-01' + "end_time") WITH &&,
        daterange("effective_from", "effective_to", '[]') WITH &&
    ) WHERE ("teacher_user_id" IS NOT NULL);
