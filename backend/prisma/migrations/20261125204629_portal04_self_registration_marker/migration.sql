-- AlterTable
ALTER TABLE "users" ADD COLUMN     "self_registered_at" TIMESTAMPTZ(6);

-- ---------------------------------------------------------------------------
-- Hand-written (PORTAL-04, contract v3): the marker of an account the visitor
-- created. Until now a self-registered account was recognised as `pending`
-- without a password; from v3 the visitor chooses the password at
-- registration, so that rule no longer holds. One-time backfill: every
-- account that already carries a self-registration link, and every account
-- created through Google sign-in (it has a Google identity and was never
-- invited), keeps being recognised. Nothing else changes.
-- ---------------------------------------------------------------------------
UPDATE "users" u
   SET "self_registered_at" = u."created_at"
 WHERE u."self_registered_at" IS NULL
   AND (
     EXISTS (SELECT 1 FROM "verification_tokens" vt
              WHERE vt."user_id" = u."id"
                AND vt."metadata" ->> 'via' = 'self_registration')
     OR (u."password_hash" IS NULL
         AND EXISTS (SELECT 1 FROM "user_identities" ui WHERE ui."user_id" = u."id")
         AND NOT EXISTS (SELECT 1 FROM "verification_tokens" vt
                          WHERE vt."user_id" = u."id" AND vt."purpose" = 'invitation'))
   );
