-- New scored question formats, and a durable avatar.
--
-- Additive only: adding enum values and a nullable column cannot break an
-- existing presentation, and every new scoring knob defaults to the values that
-- were previously hardcoded (1000 points, half-weight speed bonus, no streak).

-- TRUE_FALSE is a two-option MCQ underneath. TYPE_ANSWER matches normalised
-- text; NUMERIC scores by distance from a target.
ALTER TYPE "SlideType" ADD VALUE IF NOT EXISTS 'TRUE_FALSE';
ALTER TYPE "SlideType" ADD VALUE IF NOT EXISTS 'TYPE_ANSWER';
ALTER TYPE "SlideType" ADD VALUE IF NOT EXISTS 'NUMERIC';

-- The avatar lived only in the realtime presence channel, so a participant who
-- closed their phone before the end showed as a generic silhouette on the final
-- leaderboard. Nullable: every existing response predates it.
ALTER TABLE "Response" ADD COLUMN IF NOT EXISTS "avatar" TEXT;
