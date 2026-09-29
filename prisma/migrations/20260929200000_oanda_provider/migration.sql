-- AlterTable
ALTER TABLE "ExchangeConnection" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'ccxt';

-- AlterTable
ALTER TABLE "SessionPosition" ADD COLUMN     "venueTradeId" TEXT;

