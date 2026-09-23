-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CHAIR';

-- CreateTable
CREATE TABLE "CommitteeChair" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteeChair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeChair_userId_idx" ON "CommitteeChair"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeChair_committeeId_userId_key" ON "CommitteeChair"("committeeId", "userId");

-- AddForeignKey
ALTER TABLE "CommitteeChair" ADD CONSTRAINT "CommitteeChair_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeChair" ADD CONSTRAINT "CommitteeChair_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
