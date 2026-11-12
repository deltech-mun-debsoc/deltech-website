-- Google Form sources and the rows they produce belong to an event. Before this,
-- a response tab reused for next year's event looked "already imported", and a
-- returning student's row collided with last year's on a global unique index.

ALTER TABLE "DelegateSheetSource" ADD COLUMN "eventId" TEXT,
ADD COLUMN "lastAccess" TEXT,
ADD COLUMN "lastCheckError" TEXT,
ADD COLUMN "lastCheckNeedsAction" INTEGER,
ADD COLUMN "lastCheckRows" INTEGER,
ADD COLUMN "lastCheckedAt" TIMESTAMP(3);

-- A source belongs to the event most of its delegates were imported into...
UPDATE "DelegateSheetSource" s
SET "eventId" = (
  SELECT d."eventId" FROM "Delegate" d
  WHERE d."sourceSheetKey" = s."sheetKey"
  GROUP BY d."eventId"
  ORDER BY count(*) DESC
  LIMIT 1
);

-- ...or, if it never imported anyone, to the event running now...
UPDATE "DelegateSheetSource"
SET "eventId" = (SELECT id FROM "Event" WHERE state NOT IN ('CLOSED', 'ARCHIVED') LIMIT 1)
WHERE "eventId" IS NULL;

-- ...or, with nothing running, to the most recent event.
UPDATE "DelegateSheetSource"
SET "eventId" = (SELECT id FROM "Event" ORDER BY "createdAt" DESC LIMIT 1)
WHERE "eventId" IS NULL;

ALTER TABLE "DelegateSheetSource" ALTER COLUMN "eventId" SET NOT NULL;

DROP INDEX "DelegateSheetSource_sheetKey_key";
CREATE UNIQUE INDEX "DelegateSheetSource_eventId_sheetKey_key" ON "DelegateSheetSource"("eventId", "sheetKey");

ALTER TABLE "DelegateSheetSource" ADD CONSTRAINT "DelegateSheetSource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "Delegate_sourceSheetKey_sourceRowKey_key";
CREATE UNIQUE INDEX "Delegate_eventId_sourceSheetKey_sourceRowKey_key" ON "Delegate"("eventId", "sourceSheetKey", "sourceRowKey");
