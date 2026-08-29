-- Candidate search indexes.
--
-- The candidate list searches with `contains` + `insensitive`, which compiles to
-- ILIKE '%q%'. A b-tree cannot serve a leading wildcard, so every search was a
-- sequential scan of the cycle's candidates. Trigram indexes can.
--
-- The search now also reaches into formAnswers (the whole sheet response), which
-- without a GIN index means reading and parsing every JSONB document in the cycle.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes serve ILIKE '%...%' on the promoted columns.
CREATE INDEX IF NOT EXISTS "RecruitmentCandidate_fullName_trgm"
  ON "RecruitmentCandidate" USING GIN ("fullName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "RecruitmentCandidate_email_trgm"
  ON "RecruitmentCandidate" USING GIN ("email" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "RecruitmentCandidate_branch_trgm"
  ON "RecruitmentCandidate" USING GIN ("branch" gin_trgm_ops);

-- jsonb_path_ops is the smaller, faster operator class, and containment is what
-- Prisma's string_contains compiles to.
CREATE INDEX IF NOT EXISTS "RecruitmentCandidate_formAnswers_gin"
  ON "RecruitmentCandidate" USING GIN ("formAnswers" jsonb_path_ops);
