-- AlterTable
ALTER TABLE "course_sections" ADD COLUMN     "release_after_days" SMALLINT;


-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-20 LRN-T06 — a level opens a number of days after its
-- class starts; roadmap §4q.8, D-R145). NULL = open at once; the CHECK cannot
-- evaluate to NULL. The opening day is computed on read for each class.
-- ---------------------------------------------------------------------------
ALTER TABLE "course_sections" ADD CONSTRAINT "ck_course_sections_release_after_days"
    CHECK ("release_after_days" IS NULL OR "release_after_days" BETWEEN 0 AND 365);
