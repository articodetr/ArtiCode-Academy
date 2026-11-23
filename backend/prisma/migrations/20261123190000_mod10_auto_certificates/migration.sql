-- CH-0363: an automatic course-completion certificate carries no grade.
ALTER TABLE "certificates"
    ALTER COLUMN "percent" DROP NOT NULL,
    ALTER COLUMN "band_label" DROP NOT NULL;

-- The grade is whole or absent; written so that it can never evaluate to NULL.
ALTER TABLE "certificates" ADD CONSTRAINT "ck_certificates_grade_together"
    CHECK (("percent" IS NULL) = ("band_label" IS NULL) AND ("percent" IS NOT NULL OR "band_letter" IS NULL));
