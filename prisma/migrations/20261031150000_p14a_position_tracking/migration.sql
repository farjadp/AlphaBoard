-- AlterTable
ALTER TABLE "PaperPosition" ADD COLUMN "initialStop" DOUBLE PRECISION,
ADD COLUMN "bestPrice" DOUBLE PRECISION,
ADD COLUMN "worstPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "SessionPosition" ADD COLUMN "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing paper positions: the current stop is the best record of the initial one.
UPDATE "PaperPosition" SET "initialStop" = "stopLoss" WHERE "initialStop" IS NULL AND "stopLoss" IS NOT NULL;
