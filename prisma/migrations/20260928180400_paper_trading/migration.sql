-- CreateEnum
CREATE TYPE "PaperSide" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "PaperCloseReason" AS ENUM ('MANUAL', 'STOP_LOSS', 'TAKE_PROFIT', 'LIQUIDATION');

-- CreateEnum
CREATE TYPE "PaperOrderAction" AS ENUM ('BUY', 'SELL');

-- CreateTable
CREATE TABLE "PaperAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startingBalance" DOUBLE PRECISION NOT NULL,
    "cashBalance" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "snapshotAt" TIMESTAMP(3),
    "resetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperPosition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "PaperSide" NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "leverage" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "signalId" TEXT,
    "fees" DOUBLE PRECISION NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closePrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION,
    "closeReason" "PaperCloseReason",

    CONSTRAINT "PaperPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperOrder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "positionId" TEXT,
    "symbol" TEXT NOT NULL,
    "action" "PaperOrderAction" NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MARKET',
    "qty" DOUBLE PRECISION NOT NULL,
    "requestedPrice" DOUBLE PRECISION NOT NULL,
    "fillPrice" DOUBLE PRECISION NOT NULL,
    "slippage" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FILLED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquitySnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "equity" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperAccount_userId_key" ON "PaperAccount"("userId");

-- CreateIndex
CREATE INDEX "PaperPosition_accountId_closedAt_idx" ON "PaperPosition"("accountId", "closedAt");

-- CreateIndex
CREATE INDEX "PaperPosition_closedAt_symbol_idx" ON "PaperPosition"("closedAt", "symbol");

-- CreateIndex
CREATE INDEX "PaperOrder_accountId_createdAt_idx" ON "PaperOrder"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "EquitySnapshot_accountId_at_idx" ON "EquitySnapshot"("accountId", "at");

-- AddForeignKey
ALTER TABLE "PaperAccount" ADD CONSTRAINT "PaperAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperPosition" ADD CONSTRAINT "PaperPosition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaperAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperPosition" ADD CONSTRAINT "PaperPosition_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperOrder" ADD CONSTRAINT "PaperOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaperAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperOrder" ADD CONSTRAINT "PaperOrder_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "PaperPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquitySnapshot" ADD CONSTRAINT "EquitySnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaperAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
