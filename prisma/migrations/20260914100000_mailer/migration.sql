-- The mailer: campaigns, their recipients, and the PR outreach list.
--
-- Additive only. Nothing existing is touched, so this cannot change behaviour
-- until somebody drafts and sends a mail.

CREATE TYPE "MailAudience" AS ENUM ('DELEGATES', 'CONTACTS');
CREATE TYPE "CampaignState" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "MailCampaign" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "audience" "MailAudience" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "preset" TEXT NOT NULL DEFAULT 'custom',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "state" "CampaignState" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MailRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "delegateId" TEXT,
    "contactId" TEXT,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "MailRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MailContact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "institution" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "lastMailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MailCampaign_state_scheduledAt_idx" ON "MailCampaign"("state", "scheduledAt");
CREATE UNIQUE INDEX "MailRecipient_campaignId_email_key" ON "MailRecipient"("campaignId", "email");
CREATE INDEX "MailRecipient_campaignId_status_idx" ON "MailRecipient"("campaignId", "status");
CREATE INDEX "MailRecipient_status_sentAt_idx" ON "MailRecipient"("status", "sentAt");
CREATE UNIQUE INDEX "MailContact_email_key" ON "MailContact"("email");
CREATE INDEX "MailContact_unsubscribedAt_idx" ON "MailContact"("unsubscribedAt");

ALTER TABLE "MailRecipient" ADD CONSTRAINT "MailRecipient_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "MailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
