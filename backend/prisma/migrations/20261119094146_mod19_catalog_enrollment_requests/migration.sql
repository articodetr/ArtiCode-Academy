-- AlterEnum
ALTER TYPE "notification_category" ADD VALUE 'enrollments';

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "self_enrollment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "cover_image_url" TEXT,
ADD COLUMN     "enrollment_fee_plan_id" UUID;

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "rejected_at" TIMESTAMPTZ(6),
ADD COLUMN     "rejected_by" UUID,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "requested_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "courses_enrollment_fee_plan_id_idx" ON "courses"("enrollment_fee_plan_id");

-- CreateIndex
CREATE INDEX "enrollments_rejected_by_idx" ON "enrollments"("rejected_by");

-- CreateIndex
CREATE INDEX "enrollments_requested_at_idx" ON "enrollments"("requested_at");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_enrollment_fee_plan_id_fkey" FOREIGN KEY ("enrollment_fee_plan_id") REFERENCES "fee_plans"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-19 — the course catalog, self-enrollment and the
-- enrollment requests; roadmap §4p, decisions D-R121..D-R129, ADR-077; master
-- doc section 06). CHECKs Prisma cannot express; Prisma Migrate keeps this SQL
-- verbatim. Every CHECK below is written so that it can never evaluate to NULL
-- (a NULL result would let the row through). A request is the enrollment row
-- itself in the reserved `pending` status (D-R121): no new table, no second
-- status column; its payment state is computed from the invoices linked to the
-- enrollment, never stored. The new enum value is not used here: PostgreSQL
-- forbids using a value added by ALTER TYPE ... ADD VALUE inside the same
-- transaction.
-- ---------------------------------------------------------------------------

-- courses
-- The cover is an absolute http(s) URL without white space, at most 2,048 characters (D-R129; no upload).
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_cover_image_url"
    CHECK ("cover_image_url" IS NULL OR ("cover_image_url" ~ '^https?://[^[:space:]]+$' AND char_length("cover_image_url") <= 2048));

-- enrollments
-- A pending enrollment is a request, so it always carries the instant it was requested.
ALTER TABLE "enrollments" ADD CONSTRAINT "ck_enrollments_pending_requested"
    CHECK ("status" <> 'pending' OR "requested_at" IS NOT NULL);
-- A rejection closes a request: only a cancelled row carries it, and only a row that was requested.
ALTER TABLE "enrollments" ADD CONSTRAINT "ck_enrollments_rejected_cancelled"
    CHECK ("rejected_at" IS NULL OR ("status" = 'cancelled' AND "requested_at" IS NOT NULL));
-- A rejection always states its reason (D-R126), and a reason exists only with a rejection.
ALTER TABLE "enrollments" ADD CONSTRAINT "ck_enrollments_rejection_reason"
    CHECK (("rejected_at" IS NULL) = ("rejection_reason" IS NULL));
ALTER TABLE "enrollments" ADD CONSTRAINT "ck_enrollments_rejection_reason_text"
    CHECK ("rejection_reason" IS NULL OR char_length(btrim("rejection_reason")) BETWEEN 1 AND 500);

-- ---------------------------------------------------------------------------
-- One-time grant (D-R124). `enrollments.self_enroll` has been in the catalog
-- since the first seed but no system role held it. The seed gives a key to the
-- system roles only when the key is new to the catalog and never re-adds keys
-- an admin removed, so it cannot reach the `student` role of an existing
-- academy. A migration runs exactly once per database, so the grant is made
-- here, once: in a fresh database the roles do not exist yet and this inserts
-- nothing — the seed then creates `student` with the key among its defaults.
-- Nothing opens by itself: a class still needs `self_enrollment` (D-R123).
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p."key"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'enrollments.self_enroll' AND p."deprecated_at" IS NULL
WHERE r."key" = 'student' AND r."is_system" = true
ON CONFLICT DO NOTHING;
