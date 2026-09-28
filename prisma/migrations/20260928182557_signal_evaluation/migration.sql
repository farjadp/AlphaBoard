-- CreateEnum
CREATE TYPE "SignalOutcome" AS ENUM ('OPEN', 'TP_HIT', 'SL_HIT', 'EXPIRED', 'NO_FILL', 'INVALID');

-- CreateTable
CREATE TABLE "SignalEvaluation" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "status" "SignalOutcome" NOT NULL,
    "rMultiple" DOUBLE PRECISION,
    "exitPrice" DOUBLE PRECISION,
    "entryFilledAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "barsElapsed" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignalEvaluation_signalId_key" ON "SignalEvaluation"("signalId");

-- CreateIndex
CREATE INDEX "SignalEvaluation_status_lastCheckedAt_idx" ON "SignalEvaluation"("status", "lastCheckedAt");

-- AddForeignKey
ALTER TABLE "SignalEvaluation" ADD CONSTRAINT "SignalEvaluation_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
