-- Cross delegations become an event capability rather than a page every event shows.
ALTER TABLE "Event" ADD COLUMN "crossDelegationsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Conferences took cross delegations before this switch existed; keep them on.
UPDATE "Event" SET "crossDelegationsEnabled" = true WHERE "kind" <> 'INTRA_MUN';
