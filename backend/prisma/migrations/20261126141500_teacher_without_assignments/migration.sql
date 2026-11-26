-- ---------------------------------------------------------------------------
-- Data only (no schema change): the system `teacher` role no longer manages
-- assignments (MOD-08 — API-102..API-111). Enforced by permissions, not by the
-- UI: the three keys `assignments.read`, `assignments.manage` and
-- `assignments.grade` leave the teacher's defaults in
-- `src/authorization/system-roles.ts`.
--
-- One-time revocation. The seed grants a key to an existing system role only
-- when the key is NEW to the catalog (and these three have been there since the
-- first seed), so it cannot take them away from — nor give them back to — the
-- `teacher` role of an existing academy. A migration runs exactly once per
-- database, so the grants are removed here, once: in a fresh database the
-- roles do not exist yet and this deletes nothing — the seed then creates
-- `teacher` without the keys.
--
-- Only these `role_permissions` rows are touched. Every other role keeps its
-- keys (`academy_admin`, `student`, `guardian`, custom roles); a user who holds
-- `teacher` AND another role granting them keeps them through that role. No
-- assignment, submission, grade, notification or audit row is touched. An admin
-- may grant the keys back to `teacher` (PATCH /api/roles/:id) — the seed never
-- undoes that.
-- ---------------------------------------------------------------------------
DELETE FROM "role_permissions" rp
USING "roles" r
WHERE rp."role_id" = r."id"
  AND r."key" = 'teacher'
  AND r."is_system" = true
  AND rp."permission_key" IN ('assignments.read', 'assignments.manage', 'assignments.grade');
