-- AlterTable
ALTER TABLE "TradingSession" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "lastReconciledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExchangeConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "marketType" TEXT NOT NULL DEFAULT 'spot',
    "quote" TEXT NOT NULL DEFAULT 'USDT',
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyEnc" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "passwordEnc" TEXT,
    "uidEnc" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "keyLast4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeConnection_userId_idx" ON "ExchangeConnection"("userId");

-- AddForeignKey
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExchangeConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeConnection" ADD CONSTRAINT "ExchangeConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

