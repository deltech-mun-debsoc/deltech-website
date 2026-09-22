-- The floor: speakers lists, motions, votes and ballots.
--
-- Prisma's proposed DROP INDEX / DROP DEFAULT statements for the hand-written
-- candidate-search indexes and updatedAt defaults were removed by hand, as in
-- 20260921173214_online_committee_sessions. They are deliberate.

-- CreateEnum
CREATE TYPE "SpeakerState" AS ENUM ('QUEUED', 'SPEAKING', 'SPOKEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "MotionKind" AS ENUM ('MODERATED_CAUCUS', 'UNMODERATED_CAUCUS', 'EXTEND', 'CLOSE_DEBATE', 'OTHER');

-- CreateEnum
CREATE TYPE "MotionState" AS ENUM ('PROPOSED', 'VOTING', 'PASSED', 'FAILED', 'WITHDRAWN', 'RULED_OUT', 'IN_PROGRESS', 'ENDED');

-- CreateEnum
CREATE TYPE "VoteKind" AS ENUM ('PROCEDURAL', 'SUBSTANTIVE');

-- CreateEnum
CREATE TYPE "VoteMajority" AS ENUM ('SIMPLE', 'TWO_THIRDS');

-- CreateEnum
CREATE TYPE "VoteState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BallotChoice" AS ENUM ('YES', 'NO', 'ABSTAIN');

-- AlterTable
ALTER TABLE "CommitteeSession" ADD COLUMN     "gslSpeakingSeconds" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "SpeakerEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "motionId" TEXT,
    "portfolioId" TEXT NOT NULL,
    "portfolioName" TEXT NOT NULL,
    "liveKey" TEXT,
    "position" INTEGER NOT NULL,
    "state" "SpeakerState" NOT NULL DEFAULT 'QUEUED',
    "allottedSeconds" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMP(3),
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Motion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "MotionKind" NOT NULL,
    "state" "MotionState" NOT NULL DEFAULT 'PROPOSED',
    "proposedByPortfolioId" TEXT,
    "proposerLabel" TEXT NOT NULL,
    "topic" TEXT,
    "totalSeconds" INTEGER,
    "speakingSeconds" INTEGER,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Motion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "motionId" TEXT,
    "subject" TEXT NOT NULL,
    "kind" "VoteKind" NOT NULL,
    "majority" "VoteMajority" NOT NULL DEFAULT 'SIMPLE',
    "state" "VoteState" NOT NULL DEFAULT 'OPEN',
    "eligible" INTEGER NOT NULL,
    "yes" INTEGER NOT NULL DEFAULT 0,
    "no" INTEGER NOT NULL DEFAULT 0,
    "abstain" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteBallot" (
    "id" TEXT NOT NULL,
    "voteId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "choice" "BallotChoice" NOT NULL,
    "castById" TEXT NOT NULL,
    "castByEmail" TEXT NOT NULL,
    "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteBallot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeakerEntry_liveKey_key" ON "SpeakerEntry"("liveKey");

-- CreateIndex
CREATE INDEX "SpeakerEntry_sessionId_motionId_state_position_idx" ON "SpeakerEntry"("sessionId", "motionId", "state", "position");

-- CreateIndex
CREATE INDEX "Motion_sessionId_state_idx" ON "Motion"("sessionId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_motionId_key" ON "Vote"("motionId");

-- CreateIndex
CREATE INDEX "Vote_sessionId_state_idx" ON "Vote"("sessionId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "VoteBallot_voteId_portfolioId_key" ON "VoteBallot"("voteId", "portfolioId");

-- AddForeignKey
ALTER TABLE "SpeakerEntry" ADD CONSTRAINT "SpeakerEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommitteeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerEntry" ADD CONSTRAINT "SpeakerEntry_motionId_fkey" FOREIGN KEY ("motionId") REFERENCES "Motion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerEntry" ADD CONSTRAINT "SpeakerEntry_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Motion" ADD CONSTRAINT "Motion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommitteeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommitteeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_motionId_fkey" FOREIGN KEY ("motionId") REFERENCES "Motion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
