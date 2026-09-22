-- Online committees: session floor, roll call, and the Allotment -> Committee
-- relation that every roster query needs.
--
-- Prisma also proposed dropping four hand-written indexes it cannot express
-- (the pg_trgm and GIN candidate-search indexes from
-- 20260828120000_candidate_search_indexes) and the updatedAt defaults added by
-- 20260913110000_event_model. Those are deliberate and were removed from this
-- migration by hand. Every future `migrate dev` will propose them again.

-- CreateEnum
CREATE TYPE "CommitteeFormat" AS ENUM ('IN_PERSON', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "CommitteeSessionState" AS ENUM ('NOT_STARTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "CommitteeAttendance" AS ENUM ('EXPECTED', 'PRESENT', 'PRESENT_AND_VOTING', 'ABSENT', 'LATE');

-- AlterTable
ALTER TABLE "Committee" ADD COLUMN     "format" "CommitteeFormat" NOT NULL DEFAULT 'IN_PERSON';

-- CreateTable
CREATE TABLE "CommitteeSession" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "state" "CommitteeSessionState" NOT NULL DEFAULT 'NOT_STARTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "roomName" TEXT,
    "controllerId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "plannedSeconds" INTEGER,
    "startedById" TEXT,
    "endedById" TEXT,
    "abortedById" TEXT,
    "abortReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommitteeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAttendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "status" "CommitteeAttendance" NOT NULL DEFAULT 'EXPECTED',
    "markedAt" TIMESTAMP(3),
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeSession_committeeId_state_idx" ON "CommitteeSession"("committeeId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeSession_committeeId_attempt_key" ON "CommitteeSession"("committeeId", "attempt");

-- CreateIndex
CREATE INDEX "SessionAttendance_sessionId_status_idx" ON "SessionAttendance"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAttendance_sessionId_portfolioId_key" ON "SessionAttendance"("sessionId", "portfolioId");

-- AddForeignKey
ALTER TABLE "Allotment" ADD CONSTRAINT "Allotment_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeSession" ADD CONSTRAINT "CommitteeSession_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommitteeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
