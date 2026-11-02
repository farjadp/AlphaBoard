-- CreateEnum
CREATE TYPE "AnalystPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnalystZoneKind" AS ENUM ('BUY', 'SELL', 'TARGET', 'INVALIDATION', 'INFO');

-- CreateEnum
CREATE TYPE "AnalystZoneState" AS ENUM ('WAITING', 'ENTERED', 'BROKEN', 'SCORED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AnalystPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "rawText" TEXT NOT NULL,
    "status" "AnalystPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "events" JSONB NOT NULL DEFAULT '[]',
    "offsets" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalystPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalystZone" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "kind" "AnalystZoneKind" NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "direction" TEXT,
    "closeTf" TEXT,
    "condition" TEXT,
    "note" TEXT,
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "state" "AnalystZoneState" NOT NULL DEFAULT 'WAITING',
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredAt" TIMESTAMP(3),
    "enteredPrice" DOUBLE PRECISION,
    "outcome" TEXT,
    "mfe" DOUBLE PRECISION,
    "mae" DOUBLE PRECISION,
    "scoredAt" TIMESTAMP(3),

    CONSTRAINT "AnalystZone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalystPlan_userId_status_idx" ON "AnalystPlan"("userId", "status");

-- CreateIndex
CREATE INDEX "AnalystPlan_status_idx" ON "AnalystPlan"("status");

-- CreateIndex
CREATE INDEX "AnalystZone_planId_idx" ON "AnalystZone"("planId");

-- CreateIndex
CREATE INDEX "AnalystZone_state_idx" ON "AnalystZone"("state");

-- AddForeignKey
ALTER TABLE "AnalystPlan" ADD CONSTRAINT "AnalystPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalystZone" ADD CONSTRAINT "AnalystZone_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AnalystPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

