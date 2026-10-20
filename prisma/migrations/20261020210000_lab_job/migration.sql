-- CreateTable
CREATE TABLE "LabJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "spec" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LabJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabJob_status_createdAt_idx" ON "LabJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LabJob_userId_createdAt_idx" ON "LabJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "LabJob" ADD CONSTRAINT "LabJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

