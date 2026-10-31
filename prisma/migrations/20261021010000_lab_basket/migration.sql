-- CreateTable
CREATE TABLE "LabBasket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listedBy" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "symbols" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabBasket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabBasketSymbol" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "startHour" INTEGER NOT NULL,
    "length" INTEGER NOT NULL,
    "blob" BYTEA NOT NULL,

    CONSTRAINT "LabBasketSymbol_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabBasket_userId_createdAt_idx" ON "LabBasket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LabBasketSymbol_basketId_idx" ON "LabBasketSymbol"("basketId");

-- AddForeignKey
ALTER TABLE "LabBasket" ADD CONSTRAINT "LabBasket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabBasketSymbol" ADD CONSTRAINT "LabBasketSymbol_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "LabBasket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

