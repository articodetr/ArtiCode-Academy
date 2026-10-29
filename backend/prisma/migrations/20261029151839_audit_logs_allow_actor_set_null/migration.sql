-- Hand-written migration (no schema change in schema.prisma).
--
-- Found by TEST-007 right after the first migration: deleting a user runs the
-- referential action ON DELETE SET NULL of audit_logs.actor_user_id, which is
-- an UPDATE on audit_logs, and the statement-level append-only trigger rejected
-- it ("audit_logs is append-only") — so no user could ever be hard-deleted.
--
-- Resolution (keeps both approved decisions D5 and P11-5): the trigger becomes
-- row-level and lets through exactly one kind of update — clearing
-- actor_user_id while every other column stays identical, i.e. the effect of
-- the SET NULL action (or an explicit anonymisation of the actor). Any other
-- UPDATE, every DELETE and TRUNCATE are still rejected.

CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
           AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS "trg_audit_logs_append_only" ON "audit_logs";

CREATE TRIGGER "trg_audit_logs_append_only"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER "trg_audit_logs_no_truncate"
    BEFORE TRUNCATE ON "audit_logs"
    FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
