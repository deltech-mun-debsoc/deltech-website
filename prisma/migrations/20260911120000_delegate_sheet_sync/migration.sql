-- Intra MUN: delegates registered through a Google Form response sheet.
--
-- Additive only. Every new Delegate column is nullable (or defaulted), so the
-- existing rows are untouched; they all get NULL sheet keys, and Postgres treats
-- NULLs as distinct, so the new unique index cannot collide with existing data.

ALTER TABLE "Delegate" ADD COLUMN     "manualEditedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "query" TEXT,
ADD COLUMN     "queryResolvedAt" TIMESTAMP(3),
ADD COLUMN     "rollNumber" TEXT,
ADD COLUMN     "sourceRowHash" TEXT,
ADD COLUMN     "sourceRowKey" TEXT,
ADD COLUMN     "sourceSheetKey" TEXT;

-- CreateTable
CREATE TABLE "DelegateSheetSource" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sheetUrl" TEXT NOT NULL,
    "csvUrl" TEXT NOT NULL,
    "sheetKey" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastImportedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelegateSheetSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelegateImport" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" "ImportState" NOT NULL DEFAULT 'PENDING',
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsInvalid" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "importedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DelegateImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DelegateSheetSource_sheetKey_key" ON "DelegateSheetSource"("sheetKey");

-- CreateIndex
CREATE UNIQUE INDEX "DelegateImport_idempotencyKey_key" ON "DelegateImport"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DelegateImport_sourceId_startedAt_idx" ON "DelegateImport"("sourceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Delegate_sourceSheetKey_sourceRowKey_key" ON "Delegate"("sourceSheetKey", "sourceRowKey");

-- AddForeignKey
ALTER TABLE "DelegateImport" ADD CONSTRAINT "DelegateImport_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DelegateSheetSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

