-- A follow-up log per delegate: who was called, whether they picked up, what
-- they promised, and when to try again.
--
-- Additive only. The two new Delegate columns are nullable and start empty, which
-- is the truth: nobody has been logged as contacted before this table existed.

CREATE TYPE "ContactOutcome" AS ENUM (
  'CALLED_REACHED', 'CALLED_NO_ANSWER', 'CALLED_BUSY', 'WRONG_NUMBER',
  'WHATSAPP_SENT', 'EMAIL_SENT', 'PROMISED_TO_PAY', 'NOT_INTERESTED', 'NOTE'
);

ALTER TABLE "Delegate" ADD COLUMN "lastContactedAt" TIMESTAMP(3),
ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);

CREATE TABLE "DelegateContact" (
    "id" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "outcome" "ContactOutcome" NOT NULL,
    "note" TEXT,
    "followUpAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelegateContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DelegateContact_delegateId_createdAt_idx" ON "DelegateContact"("delegateId", "createdAt");
CREATE INDEX "Delegate_eventId_nextFollowUpAt_idx" ON "Delegate"("eventId", "nextFollowUpAt");

ALTER TABLE "DelegateContact" ADD CONSTRAINT "DelegateContact_delegateId_fkey"
  FOREIGN KEY ("delegateId") REFERENCES "Delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
