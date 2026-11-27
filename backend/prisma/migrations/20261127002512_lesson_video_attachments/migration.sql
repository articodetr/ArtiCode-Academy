-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "recording_url" TEXT;

-- Hand-written (J-F77): the video is a pasted https link like the meeting link (ck_lessons_meeting_url_https), and the
-- attachments are a JSON array; each item ({ kind: book|link, title, url }, https only, at most 20) is checked by the
-- application (lessons.attachments.ts), as a course's and a curriculum lesson's resources are.
ALTER TABLE "lessons" ADD CONSTRAINT "ck_lessons_recording_url_https"
    CHECK ("recording_url" IS NULL OR "recording_url" LIKE 'https://%');
ALTER TABLE "lessons" ADD CONSTRAINT "ck_lessons_attachments_array" CHECK (jsonb_typeof("attachments") = 'array');
