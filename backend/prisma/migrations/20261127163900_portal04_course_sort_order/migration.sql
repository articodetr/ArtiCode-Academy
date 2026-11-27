-- PORTAL-04-COURSE-ORDER (provisional id): the order of the courses, set by the office with the arrows of the courses
-- list (POST /api/courses/:id/move) and followed by the catalogs (API-219, API-236) and the office list (sort=position).
--
-- The column is what Prisma's `@default(autoincrement())` describes (a SERIAL: an integer column, NOT NULL, defaulting
-- to its own owned sequence), written by hand so the existing courses keep today's order — the catalogs listed them by
-- code — instead of the order the rows happen to sit in. A new course takes the next value, so it goes last; a move
-- swaps the places of two courses and never takes a value from the sequence.

CREATE SEQUENCE "courses_sort_order_seq" AS INTEGER;

ALTER TABLE "courses" ADD COLUMN "sort_order" INTEGER;

UPDATE "courses" AS c
SET "sort_order" = o.position
FROM (SELECT "id", (row_number() OVER (ORDER BY "code", "id"))::integer AS position FROM "courses") AS o
WHERE o."id" = c."id";

ALTER TABLE "courses"
    ALTER COLUMN "sort_order" SET NOT NULL,
    ALTER COLUMN "sort_order" SET DEFAULT nextval('"courses_sort_order_seq"');

ALTER SEQUENCE "courses_sort_order_seq" OWNED BY "courses"."sort_order";

-- The next course goes after every existing one.
SELECT setval('"courses_sort_order_seq"', COALESCE((SELECT max("sort_order") FROM "courses"), 0) + 1, false);

-- A place is a positive integer (NULL-safe: the column is NOT NULL).
ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_sort_order_positive" CHECK ("sort_order" > 0);

-- One course per place. Deferred like uq_levels_sort_order (ADR-046): a move swaps two places inside one transaction,
-- and the two rows share a place until the second UPDATE. A deferrable constraint is never an ON CONFLICT arbiter.
ALTER TABLE "courses" ADD CONSTRAINT "uq_courses_sort_order" UNIQUE ("sort_order") DEFERRABLE INITIALLY DEFERRED;
