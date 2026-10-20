-- CreateTable
CREATE TABLE "LabDataset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "bars" INTEGER NOT NULL,
    "hasSpread" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" INTEGER NOT NULL,
    "blob" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabDataset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabDataset_userId_createdAt_idx" ON "LabDataset"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "LabDataset" ADD CONSTRAINT "LabDataset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

