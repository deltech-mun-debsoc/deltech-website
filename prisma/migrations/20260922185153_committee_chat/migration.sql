-- Committee chat: floor, delegate-to-delegate and dais messages.
--
-- Prisma's proposed DROP INDEX / DROP DEFAULT statements for the hand-written
-- candidate-search indexes and updatedAt defaults were removed by hand, as in
-- 20260921173214_online_committee_sessions. They are deliberate.

-- CreateEnum
CREATE TYPE "CommitteeMessageScope" AS ENUM ('FLOOR', 'DM', 'EB');

-- CreateEnum
CREATE TYPE "CommitteeMessageState" AS ENUM ('SENT', 'HELD', 'BLOCKED');

-- AlterTable
ALTER TABLE "Committee" ADD COLUMN     "holdDirectMessages" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CommitteeMessage" (
    "id" SERIAL NOT NULL,
    "committeeId" TEXT NOT NULL,
    "scope" "CommitteeMessageScope" NOT NULL,
    "state" "CommitteeMessageState" NOT NULL DEFAULT 'SENT',
    "fromPortfolioId" TEXT,
    "toPortfolioId" TEXT,
    "fromLabel" TEXT NOT NULL,
    "toLabel" TEXT,
    "authorId" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeMessage_committeeId_id_idx" ON "CommitteeMessage"("committeeId", "id");

-- AddForeignKey
ALTER TABLE "CommitteeMessage" ADD CONSTRAINT "CommitteeMessage_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMessage" ADD CONSTRAINT "CommitteeMessage_fromPortfolioId_fkey" FOREIGN KEY ("fromPortfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMessage" ADD CONSTRAINT "CommitteeMessage_toPortfolioId_fkey" FOREIGN KEY ("toPortfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
