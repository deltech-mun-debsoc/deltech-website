CREATE TYPE "TeamLevel" AS ENUM ('AC', 'SC', 'JC');

ALTER TABLE "Member"
ADD COLUMN "level" "TeamLevel" NOT NULL DEFAULT 'JC';

CREATE INDEX "Member_level_order_idx" ON "Member"("level", "order");
