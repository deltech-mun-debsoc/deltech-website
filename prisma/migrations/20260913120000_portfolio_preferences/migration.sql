-- Portfolio preferences gain an id alongside the name the delegate typed.
--
-- Purely additive: every column is nullable, so existing rows keep only their
-- free text, which is exactly what the fallback in balance.ts is for. Nothing is
-- backfilled here on purpose. Matching old text to seats is a guess, and a wrong
-- guess would put a delegate in somebody else's chair; the resolver makes that
-- match at read time where staff can see it, rather than freezing it into data.
--
-- ON DELETE SET NULL because republishing a committee's matrix deletes its
-- portfolios. The id going quiet is correct; the typed name survives and the
-- preference stays readable.

ALTER TABLE "Delegate" ADD COLUMN "pref1PortfolioId" TEXT,
ADD COLUMN "pref2PortfolioId" TEXT,
ADD COLUMN "pref3PortfolioId" TEXT;

CREATE INDEX "Delegate_pref1PortfolioId_idx" ON "Delegate"("pref1PortfolioId");
CREATE INDEX "Delegate_pref2PortfolioId_idx" ON "Delegate"("pref2PortfolioId");
CREATE INDEX "Delegate_pref3PortfolioId_idx" ON "Delegate"("pref3PortfolioId");

ALTER TABLE "Delegate" ADD CONSTRAINT "Delegate_pref1PortfolioId_fkey"
  FOREIGN KEY ("pref1PortfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Delegate" ADD CONSTRAINT "Delegate_pref2PortfolioId_fkey"
  FOREIGN KEY ("pref2PortfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Delegate" ADD CONSTRAINT "Delegate_pref3PortfolioId_fkey"
  FOREIGN KEY ("pref3PortfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
