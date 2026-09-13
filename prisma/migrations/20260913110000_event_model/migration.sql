-- Events become first-class rows.
--
-- Until now "the event" was a few Setting rows, and every Committee and Delegate
-- belonged to it implicitly. That made two events impossible and, worse, made a
-- returning student collide: Delegate.email was unique across all time, so anyone
-- who attended last year could not register again.
--
-- Order matters here. Every column is added nullable, backfilled from the Settings
-- that describe the current event, and only then made NOT NULL. Nothing is deleted
-- and no existing row changes meaning: the rows that exist today all belong to the
-- one event that is running today.

-- CreateEnum
CREATE TYPE "EventState" AS ENUM ('DRAFT', 'OPEN', 'ALLOTMENT', 'LIVE', 'CLOSED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CONFERENCE',
    "state" "EventState" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "registrationOpen" BOOLEAN NOT NULL DEFAULT false,
    "paymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "matrixPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");
CREATE INDEX "Event_state_idx" ON "Event"("state");

-- Add the parent columns nullable, so existing rows survive the statement.
ALTER TABLE "Committee" ADD COLUMN "eventId" TEXT;
ALTER TABLE "Delegate"  ADD COLUMN "eventId" TEXT;

-- Backfill: one event, built from the Settings that currently describe it.
-- Setting.value is JSONB, so a stored string arrives quoted and #>>'{}' unwraps it.
-- Every branch is defensive: a missing or malformed key must not abort the
-- migration, because the site has to come back up either way.
DO $$
DECLARE
  event_id    TEXT := 'evt_' || replace(gen_random_uuid()::text, '-', '');
  event_name  TEXT;
  event_kind  TEXT;
  raw_mode    TEXT;
  event_state "EventState";
  reg_open   BOOLEAN;
  pay_on     BOOLEAN;
  matrix_pub BOOLEAN;
BEGIN
  SELECT NULLIF(btrim(COALESCE(value #>> '{}', '')), '') INTO event_name
    FROM "Setting" WHERE key = 'activeEventName';
  SELECT NULLIF(btrim(COALESCE(value #>> '{}', '')), '') INTO raw_mode
    FROM "Setting" WHERE key = 'eventMode';
  event_kind := raw_mode;

  SELECT COALESCE((value #>> '{}')::boolean, false) INTO reg_open
    FROM "Setting" WHERE key = 'registrationOpen';
  SELECT COALESCE((value #>> '{}')::boolean, false) INTO pay_on
    FROM "Setting" WHERE key = 'paymentsEnabled';
  SELECT COALESCE((value #>> '{}')::boolean, false) INTO matrix_pub
    FROM "Setting" WHERE key = 'matrixPublic';

  -- SOCIETY never named a kind of event. It meant "no event is running", which is
  -- now expressed as state rather than as a name: the row is created CLOSED, so
  -- getActiveEvent finds nothing and the site keeps behaving exactly as it does
  -- today. Getting this wrong would quietly switch the event hero back on.
  IF raw_mode IS NULL OR raw_mode = 'SOCIETY' THEN
    event_kind  := 'CONFERENCE';
    event_state := 'CLOSED';
  ELSE
    event_state := 'LIVE';
  END IF;

  -- Payments were only ever honoured in CONFERENCE mode, so an Intra event with a
  -- stale paymentsEnabled=true Setting must not silently start charging.
  IF raw_mode IS DISTINCT FROM 'CONFERENCE' THEN
    pay_on := false;
  END IF;

  INSERT INTO "Event" (
    "id", "name", "slug", "kind", "state",
    "registrationOpen", "paymentsEnabled", "matrixPublic",
    "createdAt", "updatedAt"
  )
  VALUES (
    event_id,
    COALESCE(event_name, 'DelTech MUN'),
    'current-event',
    event_kind,
    event_state,
    COALESCE(reg_open, false),
    COALESCE(pay_on, false),
    COALESCE(matrix_pub, false),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

  IF event_state = 'CLOSED' THEN
    UPDATE "Event" SET "closedAt" = CURRENT_TIMESTAMP WHERE id = event_id;
  END IF;

  UPDATE "Committee" SET "eventId" = event_id WHERE "eventId" IS NULL;
  UPDATE "Delegate"  SET "eventId" = event_id WHERE "eventId" IS NULL;
END $$;

-- Only now can the columns be required.
ALTER TABLE "Committee" ALTER COLUMN "eventId" SET NOT NULL;
ALTER TABLE "Delegate"  ALTER COLUMN "eventId" SET NOT NULL;

-- Identity becomes per-event. This is the change that lets a student who
-- attended a previous event register for the next one.
DROP INDEX IF EXISTS "Delegate_email_key";
DROP INDEX IF EXISTS "Committee_slug_key";
CREATE UNIQUE INDEX "Delegate_eventId_email_key" ON "Delegate"("eventId", "email");
CREATE UNIQUE INDEX "Committee_eventId_slug_key" ON "Committee"("eventId", "slug");
CREATE INDEX "Delegate_eventId_idx"  ON "Delegate"("eventId");
CREATE INDEX "Committee_eventId_idx" ON "Committee"("eventId");

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Delegate" ADD CONSTRAINT "Delegate_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The guard that makes this migration safe to ship on its own.
--
-- Committee and Delegate are still queried globally in ~89 places. Those queries
-- stay correct for exactly as long as one event is live at a time, so that is
-- enforced here rather than assumed: at most one event may sit in a state that is
-- neither CLOSED nor ARCHIVED. Creating a second live event fails loudly until
-- those queries carry an eventId, instead of quietly mixing two events together.
CREATE UNIQUE INDEX "Event_single_active_idx"
  ON "Event" ((1)) WHERE "state" NOT IN ('CLOSED', 'ARCHIVED');
