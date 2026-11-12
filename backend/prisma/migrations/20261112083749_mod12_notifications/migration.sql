-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements');

-- CreateEnum
CREATE TYPE "notification_email_status" AS ENUM ('none', 'queued', 'sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "recipient_user_id" UUID NOT NULL,
    "event_key" VARCHAR(64) NOT NULL,
    "category" "notification_category" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "student_user_id" UUID,
    "announcement_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "email_status" "notification_email_status" NOT NULL DEFAULT 'none',
    "email_sent_at" TIMESTAMPTZ(6),
    "email_message_id" TEXT,
    "email_failure" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" "notification_category" NOT NULL,
    "email_enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "sender_user_id" UUID,
    "audience" JSONB NOT NULL,
    "class_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "send_email" BOOLEAN NOT NULL DEFAULT false,
    "recipient_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_id_idx" ON "notifications"("recipient_user_id", "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_student_user_id_idx" ON "notifications"("student_user_id");

-- CreateIndex
CREATE INDEX "notifications_announcement_id_idx" ON "notifications"("announcement_id");

-- CreateIndex
CREATE INDEX "announcements_sender_user_id_id_idx" ON "announcements"("sender_user_id", "id" DESC);

-- CreateIndex
CREATE INDEX "announcements_class_id_idx" ON "announcements"("class_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-12-T01 — roadmap §4j.2; owner decisions D-R79..D-R86,
-- CH-0200; master doc section 06). CHECKs and the two partial indexes Prisma
-- cannot express; Prisma Migrate keeps this SQL verbatim. No role names, no
-- data, no extension. Who receives a notification, the list of event keys, the
-- wording and the audience rules of an announcement stay service rules
-- (T02..T05). Every CHECK below is written so that it can never evaluate to
-- NULL (a NULL result would let the row through).
-- ---------------------------------------------------------------------------

-- notifications
-- A lower-case dotted key such as `assignment.published`; the list of events lives in code (D-R80).
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_event_key_format"
    CHECK ("event_key" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)*$');
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_title_not_blank"
    CHECK (btrim("title") <> '');
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_body_not_blank"
    CHECK (btrim("body") <> '');
-- `data` carries the frontend path and ids only; always a JSON object.
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_data_object"
    CHECK (jsonb_typeof("data") = 'object');
-- A notification of the `announcements` category points to its announcement, and no other does (D-R85).
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_announcement_link"
    CHECK (("announcement_id" IS NOT NULL) = ("category" = 'announcements'));
-- The e-mail copy (D-R82): a sending instant exactly for `sent`; a provider message id only for `sent`;
-- a failure code always for `failed`, optionally for `skipped`, never otherwise (a code, trimmed, not the provider's text).
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_email_sent_at"
    CHECK (("email_sent_at" IS NOT NULL) = ("email_status" = 'sent'));
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_email_message_id_only_sent"
    CHECK ("email_message_id" IS NULL OR ("email_status" = 'sent' AND btrim("email_message_id") <> ''));
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_email_failure"
    CHECK (
        ("email_status" = 'failed' AND "email_failure" IS NOT NULL AND "email_failure" = btrim("email_failure") AND "email_failure" <> '')
        OR ("email_status" = 'skipped' AND ("email_failure" IS NULL OR ("email_failure" = btrim("email_failure") AND "email_failure" <> '')))
        OR ("email_status" NOT IN ('failed', 'skipped') AND "email_failure" IS NULL)
    );
-- The unread counter and "mark all as read" (API-168/API-170): only unread rows are indexed.
CREATE INDEX "ix_notifications_recipient_unread"
    ON "notifications" ("recipient_user_id") WHERE "read_at" IS NULL;
-- The e-mails still waiting for the dispatcher, oldest first (picked up once at boot — D-R82).
CREATE INDEX "ix_notifications_email_queued"
    ON "notifications" ("created_at") WHERE "email_status" = 'queued';

-- announcements
-- The audience as requested: a JSON object whose `kind` is `class` or `academy` (its members are a service rule — D-R85).
ALTER TABLE "announcements" ADD CONSTRAINT "ck_announcements_audience_kind"
    CHECK (jsonb_typeof("audience") = 'object' AND COALESCE("audience" ->> 'kind', '') IN ('class', 'academy'));
-- Only a class announcement carries a class; the link may become NULL when the class goes (SetNull), the audience keeps its id.
ALTER TABLE "announcements" ADD CONSTRAINT "ck_announcements_class_scope"
    CHECK ("class_id" IS NULL OR COALESCE("audience" ->> 'kind', '') = 'class');
ALTER TABLE "announcements" ADD CONSTRAINT "ck_announcements_title_length"
    CHECK (btrim("title") <> '' AND char_length("title") <= 200);
ALTER TABLE "announcements" ADD CONSTRAINT "ck_announcements_body_length"
    CHECK (btrim("body") <> '' AND char_length("body") <= 4000);
ALTER TABLE "announcements" ADD CONSTRAINT "ck_announcements_recipient_count_non_negative"
    CHECK ("recipient_count" >= 0);
