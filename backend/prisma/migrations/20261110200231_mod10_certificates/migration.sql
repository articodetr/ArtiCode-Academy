-- CreateEnum
CREATE TYPE "certificate_status" AS ENUM ('issued', 'revoked');

-- CreateTable
CREATE TABLE "number_sequences" (
    "key" VARCHAR(32) NOT NULL,
    "period" VARCHAR(8) NOT NULL DEFAULT '',
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("key","period")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "serial" VARCHAR(32) NOT NULL,
    "verification_code" VARCHAR(32) NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status" "certificate_status" NOT NULL DEFAULT 'issued',
    "percent" DECIMAL(5,2) NOT NULL,
    "band_label" JSONB NOT NULL,
    "band_letter" VARCHAR(4),
    "snapshot" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoke_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificates_serial_key" ON "certificates"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verification_code_key" ON "certificates"("verification_code");

-- CreateIndex
CREATE INDEX "certificates_enrollment_id_idx" ON "certificates"("enrollment_id");

-- CreateIndex
CREATE INDEX "certificates_class_id_idx" ON "certificates"("class_id");

-- CreateIndex
CREATE INDEX "certificates_course_id_idx" ON "certificates"("course_id");

-- CreateIndex
CREATE INDEX "certificates_student_user_id_idx" ON "certificates"("student_user_id");

-- CreateIndex
CREATE INDEX "certificates_status_issued_at_idx" ON "certificates"("status", "issued_at");

-- CreateIndex
CREATE INDEX "certificates_issued_by_idx" ON "certificates"("issued_by");

-- CreateIndex
CREATE INDEX "certificates_revoked_by_idx" ON "certificates"("revoked_by");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-10-T01 — roadmap §4h.10.2; owner decisions
-- D-R50..D-R57, CH-0174; master doc section 06). CHECKs and the partial unique
-- index Prisma cannot express; Prisma Migrate keeps this SQL verbatim. No role
-- names, no data, no extension. Eligibility (a completed enrollment with a
-- passing, non-stale final grade) spans several tables and stays a service rule
-- (T02).
-- ---------------------------------------------------------------------------

-- number_sequences
ALTER TABLE "number_sequences" ADD CONSTRAINT "ck_number_sequences_key_trimmed"
    CHECK ("key" = btrim("key") AND "key" <> '');
ALTER TABLE "number_sequences" ADD CONSTRAINT "ck_number_sequences_period_trimmed"
    CHECK ("period" = btrim("period"));
ALTER TABLE "number_sequences" ADD CONSTRAINT "ck_number_sequences_last_value_non_negative"
    CHECK ("last_value" >= 0);

-- certificates
ALTER TABLE "certificates" ADD CONSTRAINT "ck_certificates_serial_trimmed"
    CHECK ("serial" = btrim("serial") AND "serial" <> '');
ALTER TABLE "certificates" ADD CONSTRAINT "ck_certificates_verification_code_format"
    CHECK ("verification_code" ~ '^[A-Z2-7]{16,32}$');
ALTER TABLE "certificates" ADD CONSTRAINT "ck_certificates_percent_range"
    CHECK ("percent" >= 0 AND "percent" <= 100);
ALTER TABLE "certificates" ADD CONSTRAINT "ck_certificates_band_label_localized"
    CHECK (jsonb_typeof("band_label") = 'object' AND "band_label" ? 'ar');
ALTER TABLE "certificates" ADD CONSTRAINT "ck_certificates_band_letter_trimmed"
    CHECK ("band_letter" IS NULL OR ("band_letter" = btrim("band_letter") AND "band_letter" <> ''));
ALTER TABLE "certificates" ADD CONSTRAINT "ck_certificates_snapshot_object"
    CHECK (jsonb_typeof("snapshot") = 'object');
-- A revoked certificate carries its instant and a non-empty reason; an issued one carries neither
-- (`revoked_by` may become NULL when the user is deleted — SetNull).
ALTER TABLE "certificates" ADD CONSTRAINT "ck_certificates_revocation"
    CHECK (
        ("status" = 'issued' AND "revoked_at" IS NULL AND "revoked_by" IS NULL AND "revoke_reason" IS NULL)
        OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL AND "revoke_reason" IS NOT NULL AND btrim("revoke_reason") <> '')
    );
-- At most one issued certificate per enrollment (D-R55): a revoked one stays as history and a new one may be issued.
CREATE UNIQUE INDEX "uq_certificates_enrollment_issued"
    ON "certificates" ("enrollment_id") WHERE "status" = 'issued';
