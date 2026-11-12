-- Voice channel visits: who was in which lobbying channel, and when.
--
-- Prisma's proposed DROP INDEX / DROP DEFAULT statements for the hand-written
-- candidate-search indexes and updatedAt defaults were removed by hand, as in
-- 20260921173214_online_committee_sessions. They are deliberate.

-- CreateTable
CREATE TABLE "VoiceChannelVisit" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "portfolioId" TEXT,
    "identity" TEXT NOT NULL,
    "participantSid" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceChannelVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceChannelVisit_participantSid_key" ON "VoiceChannelVisit"("participantSid");

-- CreateIndex
CREATE INDEX "VoiceChannelVisit_committeeId_sessionId_joinedAt_idx" ON "VoiceChannelVisit"("committeeId", "sessionId", "joinedAt");
