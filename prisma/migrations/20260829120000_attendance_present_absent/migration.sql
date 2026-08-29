-- Attendance becomes first come, first served.
--
-- EXPECTED and LATE were ceremony: LATE already behaved identically to PRESENT
-- everywhere (it set joinedAt, it counted as present on session finish, it was
-- "owed a score"), and EXPECTED just meant "nobody has touched this row". A
-- candidate seated in a group is present unless someone marks them absent.
--
-- ABSENT stays: it is what returns a no-show to the queue when a session finishes.
-- REASSIGNED stays and is load-bearing: the partial unique index
-- RecruitmentGroupMember_one_active_per_kind excludes it, which is what lets a
-- candidate be moved between groups without tripping the constraint.
--
-- Postgres cannot drop a value from an enum in place, so the type is recreated.

-- Existing rows: both removed values mean "was going to be, or was, in the room".
UPDATE "RecruitmentGroupMember" SET "attendance" = 'PRESENT'
  WHERE "attendance" IN ('EXPECTED', 'LATE');

-- The partial unique index has the old type baked into its predicate, so it must
-- be dropped before the column can be retyped and recreated against the new type.
DROP INDEX IF EXISTS "RecruitmentGroupMember_one_active_per_kind";

ALTER TYPE "Attendance" RENAME TO "Attendance_old";

CREATE TYPE "Attendance" AS ENUM ('PRESENT', 'ABSENT', 'REASSIGNED');

-- The default has to go before the column can be retyped, and comes back after.
ALTER TABLE "RecruitmentGroupMember" ALTER COLUMN "attendance" DROP DEFAULT;

ALTER TABLE "RecruitmentGroupMember"
  ALTER COLUMN "attendance" TYPE "Attendance"
  USING ("attendance"::text::"Attendance");

ALTER TABLE "RecruitmentGroupMember"
  ALTER COLUMN "attendance" SET DEFAULT 'PRESENT';

DROP TYPE "Attendance_old";

-- Recreated against the new type. A candidate may hold only one live seat per kind;
-- REASSIGNED rows are excluded so history is kept rather than deleted.
CREATE UNIQUE INDEX "RecruitmentGroupMember_one_active_per_kind"
  ON "RecruitmentGroupMember" ("candidateId", "kind")
  WHERE "attendance" <> 'REASSIGNED';
