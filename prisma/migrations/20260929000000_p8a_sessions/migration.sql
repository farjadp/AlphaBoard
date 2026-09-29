-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('RUNNING', 'PAUSED', 'AWAITING_EXTENSION', 'ENDING', 'ENDED', 'HALTED');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('COMPLETED', 'USER_ENDED', 'LOSS_LIMIT', 'KILL', 'RECONCILE_MISMATCH', 'LLM_BUDGET', 'ERROR', 'EXTENSION_TIMEOUT');

-- CreateEnum
CREATE TYPE "SessionRole" AS ENUM ('MARKET', 'NEWS', 'BULL', 'BEAR', 'STRATEGIST', 'RISK', 'EXECUTOR', 'JOURNAL', 'SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "SessionMessageKind" AS ENUM ('TEXT', 'PROPOSAL', 'VERDICT', 'ORDER', 'FILL', 'ALERT', 'REPORT');

-- CreateEnum
CREATE TYPE "SessionOrderStatus" AS ENUM ('PENDING', 'OPEN', 'PARTIAL', 'FILLED', 'CANCELED', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SessionOrderPurpose" AS ENUM ('ENTRY', 'EXIT', 'STOP', 'TAKE_PROFIT');

-- CreateEnum
CREATE TYPE "SessionCloseReason" AS ENUM ('MANUAL', 'STRATEGIST', 'STOP_LOSS', 'TAKE_PROFIT', 'LIQUIDATION', 'LOSS_LIMIT', 'KILL', 'SESSION_END');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "sessionPositionId" TEXT;

-- CreateTable
CREATE TABLE "TradingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'RUNNING',
    "live" BOOLEAN NOT NULL DEFAULT false,
    "venue" TEXT NOT NULL DEFAULT 'paper',
    "mandate" JSONB NOT NULL,
    "capital" DOUBLE PRECISION NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "SessionEndReason",
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "llmCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tradesCount" INTEGER NOT NULL DEFAULT 0,
    "cycleCount" INTEGER NOT NULL DEFAULT 0,
    "skipStreak" INTEGER NOT NULL DEFAULT 0,
    "agentFailStreak" INTEGER NOT NULL DEFAULT 0,
    "llmBudgetHit" BOOLEAN NOT NULL DEFAULT false,
    "lastCycleAt" TIMESTAMP(3),
    "nextCycleAt" TIMESTAMP(3),
    "lastPrices" JSONB,
    "startPrices" JSONB,
    "extensionPromptAt" TIMESTAMP(3),
    "extensionChatId" TEXT,
    "extensionMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionPosition" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "PaperSide" NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "leverage" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "exitPlan" JSONB NOT NULL,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closePrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION,
    "closeReason" "SessionCloseReason",
    "journalEntryId" TEXT,

    CONSTRAINT "SessionPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionOrder" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "positionId" TEXT,
    "clientOrderId" TEXT NOT NULL,
    "venueOrderId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "PaperOrderAction" NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'market',
    "purpose" "SessionOrderPurpose" NOT NULL,
    "reduceOnly" BOOLEAN NOT NULL DEFAULT false,
    "amount" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "status" "SessionOrderStatus" NOT NULL DEFAULT 'PENDING',
    "filled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPrice" DOUBLE PRECISION,
    "fee" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "SessionRole" NOT NULL,
    "kind" "SessionMessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "data" JSONB,
    "costUsd" DOUBLE PRECISION,
    "cycle" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionReport" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "lessons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTradingLimits" (
    "userId" TEXT NOT NULL,
    "maxDailyLoss" DOUBLE PRECISION,
    "maxSessionsPerDay" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTradingLimits_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TelegramAction" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "action" TEXT NOT NULL,
    "positionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramAction_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "TradingSession_userId_createdAt_idx" ON "TradingSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TradingSession_status_idx" ON "TradingSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionPosition_journalEntryId_key" ON "SessionPosition"("journalEntryId");

-- CreateIndex
CREATE INDEX "SessionPosition_sessionId_closedAt_idx" ON "SessionPosition"("sessionId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionOrder_clientOrderId_key" ON "SessionOrder"("clientOrderId");

-- CreateIndex
CREATE INDEX "SessionOrder_sessionId_createdAt_idx" ON "SessionOrder"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionMessage_sessionId_createdAt_idx" ON "SessionMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionReport_sessionId_key" ON "SessionReport"("sessionId");

-- CreateIndex
CREATE INDEX "TelegramAction_expiresAt_idx" ON "TelegramAction"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_sessionPositionId_key" ON "JournalEntry"("sessionPositionId");

-- AddForeignKey
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPosition" ADD CONSTRAINT "SessionPosition_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionOrder" ADD CONSTRAINT "SessionOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionOrder" ADD CONSTRAINT "SessionOrder_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "SessionPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionMessage" ADD CONSTRAINT "SessionMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionReport" ADD CONSTRAINT "SessionReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTradingLimits" ADD CONSTRAINT "UserTradingLimits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramAction" ADD CONSTRAINT "TelegramAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramAction" ADD CONSTRAINT "TelegramAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

