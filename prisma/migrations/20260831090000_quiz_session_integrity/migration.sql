-- Persist the live question lifecycle so presenter/participant reloads recover
-- the same state and the answer API can enforce lock, reveal and deadline.
ALTER TABLE "QuizSession"
  ADD COLUMN "currentSlideDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "currentSlideLockedAt" TIMESTAMP(3),
  ADD COLUMN "currentSlideRevealedAt" TIMESTAMP(3);

-- Nicknames are identity in an anonymous room. Treat casing and repeated
-- whitespace as the same identity so "Arnav", "arnav" and " Arnav " cannot
-- collect separate scores on one question.
DELETE FROM "Response" a
USING "Response" b
WHERE a."nickname" IS NOT NULL
  AND b."nickname" IS NOT NULL
  AND a."sessionId" = b."sessionId"
  AND a."slideId" = b."slideId"
  AND lower(regexp_replace(trim(a."nickname"), '\s+', ' ', 'g')) =
      lower(regexp_replace(trim(b."nickname"), '\s+', ' ', 'g'))
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

CREATE UNIQUE INDEX "Response_session_slide_nickname_normalized_key"
ON "Response" (
  "sessionId",
  "slideId",
  lower(regexp_replace(trim("nickname"), '\s+', ' ', 'g'))
)
WHERE "nickname" IS NOT NULL;
