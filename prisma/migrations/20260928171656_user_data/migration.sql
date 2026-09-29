-- CreateEnum
CREATE TYPE "TradePosition" AS ENUM ('LONG', 'SHORT', 'SPOT');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AlertCondition" AS ENUM ('above', 'below');

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legacyId" TEXT,
    "symbol" TEXT NOT NULL,
    "position" "TradePosition" NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'OPEN',
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "pnlPercent" DOUBLE PRECISION,
    "grossPnlPercent" DOUBLE PRECISION,
    "feeRatePercent" DOUBLE PRECISION,
    "pnlSource" TEXT,
    "emotion" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "leverage" DOUBLE PRECISION,
    "margin" DOUBLE PRECISION,
    "marginMode" TEXT,
    "screenshotId" TEXT,
    "postMortem" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeLesson" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legacyId" TEXT,
    "journalEntryId" TEXT,
    "symbol" TEXT NOT NULL,
    "position" "TradePosition" NOT NULL,
    "outcome" TEXT NOT NULL,
    "pnlPercent" DOUBLE PRECISION,
    "timeframe" TEXT,
    "rootCause" TEXT NOT NULL,
    "mistakes" TEXT[],
    "strengths" TEXT[],
    "lesson" TEXT NOT NULL,
    "tags" TEXT[],
    "emotion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legacyId" TEXT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "priceAtSignal" DOUBLE PRECISION NOT NULL,
    "entry" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "takeProfit" DOUBLE PRECISION NOT NULL,
    "tradeStyle" TEXT,
    "riskManagement" JSONB,
    "supportResistance" JSONB,
    "safeEntries" JSONB,
    "reasoning" TEXT NOT NULL,
    "indicatorsBreakdown" JSONB,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartLesson" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legacyId" TEXT,
    "symbol" TEXT,
    "overallSignal" TEXT NOT NULL,
    "confluenceScore" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "patterns" TEXT[],
    "tags" TEXT[],
    "mistakes" TEXT[],
    "strengths" TEXT[],
    "charts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChartLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legacyId" TEXT,
    "symbol" TEXT NOT NULL,
    "targetPrice" DOUBLE PRECISION NOT NULL,
    "condition" "AlertCondition" NOT NULL,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchlistItem_userId_position_idx" ON "WatchlistItem"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_userId_symbol_key" ON "WatchlistItem"("userId", "symbol");

-- CreateIndex
CREATE INDEX "Attachment_userId_idx" ON "Attachment"("userId");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_openedAt_idx" ON "JournalEntry"("userId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_userId_legacyId_key" ON "JournalEntry"("userId", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeLesson_journalEntryId_key" ON "TradeLesson"("journalEntryId");

-- CreateIndex
CREATE INDEX "TradeLesson_userId_createdAt_idx" ON "TradeLesson"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeLesson_userId_legacyId_key" ON "TradeLesson"("userId", "legacyId");

-- CreateIndex
CREATE INDEX "Signal_userId_createdAt_idx" ON "Signal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Signal_symbol_createdAt_idx" ON "Signal"("symbol", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_userId_legacyId_key" ON "Signal"("userId", "legacyId");

-- CreateIndex
CREATE INDEX "ChartLesson_userId_createdAt_idx" ON "ChartLesson"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChartLesson_userId_legacyId_key" ON "ChartLesson"("userId", "legacyId");

-- CreateIndex
CREATE INDEX "PriceAlert_userId_triggered_idx" ON "PriceAlert"("userId", "triggered");

-- CreateIndex
CREATE UNIQUE INDEX "PriceAlert_userId_legacyId_key" ON "PriceAlert"("userId", "legacyId");

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeLesson" ADD CONSTRAINT "TradeLesson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeLesson" ADD CONSTRAINT "TradeLesson_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartLesson" ADD CONSTRAINT "ChartLesson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
