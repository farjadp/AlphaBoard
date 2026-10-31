-- CreateEnum
CREATE TYPE "TradeSignalStatus" AS ENUM ('PENDING', 'SENT', 'OPEN', 'CLOSED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SignalLegStatus" AS ENUM ('OPEN', 'TP', 'SL', 'CLOSED');

-- CreateTable
CREATE TABLE "Mt5Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "login" TEXT,
    "server" TEXT,
    "tradeMode" TEXT,
    "balance" DOUBLE PRECISION,
    "currency" TEXT,
    "symbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entry" DOUBLE PRECISION,
    "stop" DOUBLE PRECISION NOT NULL,
    "tps" DOUBLE PRECISION[],
    "riskPct" DOUBLE PRECISION NOT NULL,
    "maxDeviation" DOUBLE PRECISION,
    "note" TEXT,
    "execute" BOOLEAN NOT NULL,
    "post" BOOLEAN NOT NULL,
    "status" "TradeSignalStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "deviceId" TEXT,
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pendingCommand" TEXT,
    "channelMessageId" INTEGER,
    "channelError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeSignalLeg" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "leg" INTEGER NOT NULL,
    "ticket" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "openPrice" DOUBLE PRECISION NOT NULL,
    "tp" DOUBLE PRECISION,
    "status" "SignalLegStatus" NOT NULL DEFAULT 'OPEN',
    "closePrice" DOUBLE PRECISION,
    "r" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "TradeSignalLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Device_tokenHash_key" ON "Mt5Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Mt5Device_userId_idx" ON "Mt5Device"("userId");

-- CreateIndex
CREATE INDEX "TradeSignal_userId_createdAt_idx" ON "TradeSignal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeSignal_status_expiresAt_idx" ON "TradeSignal"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeSignalLeg_signalId_leg_key" ON "TradeSignalLeg"("signalId", "leg");

-- AddForeignKey
ALTER TABLE "Mt5Device" ADD CONSTRAINT "Mt5Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Mt5Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignalLeg" ADD CONSTRAINT "TradeSignalLeg_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "TradeSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

