-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "resources" JSONB NOT NULL DEFAULT '[]';

-- Hand-written (J-F67): the course's materials are a JSON array; each item ({ title, url }, https only, at most 20)
-- is checked by the application, as a lesson's resources are (course_syllabus_items.resources).
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_resources_array" CHECK (jsonb_typeof("resources") = 'array');
