-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('draft', 'issued', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'bank_transfer', 'card', 'cheque', 'other');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('completed', 'reversed');

-- CreateTable
CREATE TABLE "fee_plans" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" JSONB NOT NULL,
    "course_id" UUID,
    "class_id" UUID,
    "lines" JSONB NOT NULL,
    "installments" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" VARCHAR(32),
    "student_user_id" UUID NOT NULL,
    "enrollment_id" UUID,
    "fee_plan_id" UUID,
    "status" "invoice_status" NOT NULL DEFAULT 'draft',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_reason" TEXT,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "issued_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "invoice_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "description" JSONB NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_installments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "invoice_id" UUID NOT NULL,
    "seq" SMALLINT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_on" DATE NOT NULL,

    CONSTRAINT "invoice_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" VARCHAR(32) NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'completed',
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "reference" TEXT,
    "payer_name" TEXT,
    "notes" TEXT,
    "recorded_by" UUID,
    "reversed_at" TIMESTAMPTZ(6),
    "reversed_by" UUID,
    "reverse_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_plans_course_id_idx" ON "fee_plans"("course_id");

-- CreateIndex
CREATE INDEX "fee_plans_class_id_idx" ON "fee_plans"("class_id");

-- CreateIndex
CREATE INDEX "fee_plans_created_by_idx" ON "fee_plans"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_student_user_id_idx" ON "invoices"("student_user_id");

-- CreateIndex
CREATE INDEX "invoices_enrollment_id_idx" ON "invoices"("enrollment_id");

-- CreateIndex
CREATE INDEX "invoices_fee_plan_id_idx" ON "invoices"("fee_plan_id");

-- CreateIndex
CREATE INDEX "invoices_status_issued_at_idx" ON "invoices"("status", "issued_at");

-- CreateIndex
CREATE INDEX "invoices_issued_by_idx" ON "invoices"("issued_by");

-- CreateIndex
CREATE INDEX "invoices_cancelled_by_idx" ON "invoices"("cancelled_by");

-- CreateIndex
CREATE INDEX "invoices_created_by_idx" ON "invoices"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_invoice_lines_order" ON "invoice_lines"("invoice_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "uq_invoice_installments_seq" ON "invoice_installments"("invoice_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "payments_number_key" ON "payments"("number");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_status_paid_at_idx" ON "payments"("status", "paid_at");

-- CreateIndex
CREATE INDEX "payments_recorded_by_idx" ON "payments"("recorded_by");

-- CreateIndex
CREATE INDEX "payments_reversed_by_idx" ON "payments"("reversed_by");

-- AddForeignKey
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fee_plan_id_fkey" FOREIGN KEY ("fee_plan_id") REFERENCES "fee_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_installments" ADD CONSTRAINT "invoice_installments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part (MOD-11-T01 — roadmap §4i.2; owner decisions D-R58..D-R65,
-- CH-0181; master doc section 06). CHECKs Prisma cannot express; Prisma
-- Migrate keeps this SQL verbatim. No role names, no data, no extension.
-- Cross-row rules (installments summing to the total, a payment within the
-- balance, plan lines and shares) stay service rules (T02..T04).
-- ---------------------------------------------------------------------------

-- fee_plans
ALTER TABLE "fee_plans" ADD CONSTRAINT "ck_fee_plans_name_localized"
    CHECK (jsonb_typeof("name") = 'object' AND "name" ? 'ar');
-- A plan prices a course or a class, never both; neither = a general plan.
ALTER TABLE "fee_plans" ADD CONSTRAINT "ck_fee_plans_scope"
    CHECK ("course_id" IS NULL OR "class_id" IS NULL);
ALTER TABLE "fee_plans" ADD CONSTRAINT "ck_fee_plans_lines_array"
    CHECK (jsonb_typeof("lines") = 'array');
ALTER TABLE "fee_plans" ADD CONSTRAINT "ck_fee_plans_installments_array"
    CHECK (jsonb_typeof("installments") = 'array');

-- invoices
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_currency"
    CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_amounts_non_negative"
    CHECK ("subtotal" >= 0 AND "discount_amount" >= 0 AND "paid_amount" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_discount_range"
    CHECK ("discount_amount" <= "subtotal" AND ("discount_reason" IS NULL OR "discount_amount" > 0));
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_total"
    CHECK ("total_amount" = "subtotal" - "discount_amount");
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_paid_range"
    CHECK ("paid_amount" <= "total_amount");
-- A draft has neither a number nor an issue instant; an issued or cancelled invoice has both (D-R61).
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_issued"
    CHECK ((("number" IS NOT NULL) = ("status" <> 'draft')) AND (("issued_at" IS NOT NULL) = ("status" <> 'draft')));
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_number_trimmed"
    CHECK ("number" IS NULL OR ("number" = btrim("number") AND "number" <> ''));
-- A cancelled invoice carries its instant and a non-empty reason; any other carries none (`cancelled_by` may become NULL — SetNull).
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_cancellation"
    CHECK (
        ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") <> '')
        OR ("status" <> 'cancelled' AND "cancelled_at" IS NULL AND "cancelled_by" IS NULL AND "cancel_reason" IS NULL)
    );

-- invoice_lines
ALTER TABLE "invoice_lines" ADD CONSTRAINT "ck_invoice_lines_amount_positive"
    CHECK ("amount" > 0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "ck_invoice_lines_description_localized"
    CHECK (jsonb_typeof("description") = 'object' AND "description" ? 'ar');
ALTER TABLE "invoice_lines" ADD CONSTRAINT "ck_invoice_lines_sort_order"
    CHECK ("sort_order" >= 0);

-- invoice_installments
ALTER TABLE "invoice_installments" ADD CONSTRAINT "ck_invoice_installments_amount_positive"
    CHECK ("amount" > 0);
ALTER TABLE "invoice_installments" ADD CONSTRAINT "ck_invoice_installments_seq_range"
    CHECK ("seq" >= 1 AND "seq" <= 24);

-- payments
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_amount_positive"
    CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_currency"
    CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_number_trimmed"
    CHECK ("number" = btrim("number") AND "number" <> '');
-- A reversed payment carries its instant and a non-empty reason; a completed one carries none (D-R63; `reversed_by` may become NULL).
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_reversal"
    CHECK (
        ("status" = 'reversed' AND "reversed_at" IS NOT NULL AND "reverse_reason" IS NOT NULL AND btrim("reverse_reason") <> '')
        OR ("status" = 'completed' AND "reversed_at" IS NULL AND "reversed_by" IS NULL AND "reverse_reason" IS NULL)
    );
