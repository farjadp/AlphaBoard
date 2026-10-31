-- CreateTable
CREATE TABLE "Mt5Trade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION NOT NULL,
    "stop" DOUBLE PRECISION,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "net" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "magic" INTEGER NOT NULL,
    "manual" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mt5Trade_userId_symbol_openedAt_idx" ON "Mt5Trade"("userId", "symbol", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Trade_userId_login_positionId_key" ON "Mt5Trade"("userId", "login", "positionId");

-- AddForeignKey
ALTER TABLE "Mt5Trade" ADD CONSTRAINT "Mt5Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

