-- Decisions made in the Form import review, kept with the source so a routine
-- check does not ask the same question again.
ALTER TABLE "DelegateSheetSource" ADD COLUMN "resolutions" JSONB NOT NULL DEFAULT '{}';
