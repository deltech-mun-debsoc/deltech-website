-- SES events (delivery, bounce, complaint) are matched to the email they are
-- about and written onto it, instead of arriving as unrelated rows.
ALTER TABLE "EmailLog" ADD COLUMN "providerMessageId" TEXT;
CREATE INDEX "EmailLog_providerMessageId_idx" ON "EmailLog"("providerMessageId");

ALTER TABLE "MailRecipient" ADD COLUMN "providerMessageId" TEXT;
CREATE INDEX "MailRecipient_providerMessageId_idx" ON "MailRecipient"("providerMessageId");

-- An interrupted send is uncertain, not failed: it may have gone out.
ALTER TYPE "RecipientStatus" ADD VALUE 'UNCERTAIN';
