/*
  Warnings:

  - You are about to drop the column `gslSpeakingSeconds` on the `CommitteeSession` table. All the data in the column will be lost.
  - You are about to drop the column `motionId` on the `Vote` table. All the data in the column will be lost.
  - You are about to drop the `Motion` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SessionAttendance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SpeakerEntry` table. If the table is not empty, all the data it contains will be lost.

*/
-- Chairs keep attendance, speakers lists and motions on their own sheets, so
-- those tables go. Refuse rather than drop anything a real session recorded.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SessionAttendance") OR EXISTS (SELECT 1 FROM "SpeakerEntry") OR EXISTS (SELECT 1 FROM "Motion") THEN
    RAISE EXCEPTION 'committee_mic_not_lists: roll call, speakers or motions hold rows; export them before applying this migration';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "Motion" DROP CONSTRAINT "Motion_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "SessionAttendance" DROP CONSTRAINT "SessionAttendance_portfolioId_fkey";

-- DropForeignKey
ALTER TABLE "SessionAttendance" DROP CONSTRAINT "SessionAttendance_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "SpeakerEntry" DROP CONSTRAINT "SpeakerEntry_motionId_fkey";

-- DropForeignKey
ALTER TABLE "SpeakerEntry" DROP CONSTRAINT "SpeakerEntry_portfolioId_fkey";

-- DropForeignKey
ALTER TABLE "SpeakerEntry" DROP CONSTRAINT "SpeakerEntry_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_motionId_fkey";

-- DropIndex
DROP INDEX "Vote_motionId_key";

-- AlterTable
ALTER TABLE "CommitteeSession" DROP COLUMN "gslSpeakingSeconds",
ADD COLUMN     "micPortfolioId" TEXT;

-- AlterTable
ALTER TABLE "Vote" DROP COLUMN "motionId";

-- DropTable
DROP TABLE "Motion";

-- DropTable
DROP TABLE "SessionAttendance";

-- DropTable
DROP TABLE "SpeakerEntry";

-- DropEnum
DROP TYPE "CommitteeAttendance";

-- DropEnum
DROP TYPE "MotionKind";

-- DropEnum
DROP TYPE "MotionState";

-- DropEnum
DROP TYPE "SpeakerState";
