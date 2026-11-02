-- AlterTable
ALTER TABLE "AnalystPlan" ADD COLUMN     "postToChannel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AnalystZone" ADD COLUMN     "channelError" TEXT,
ADD COLUMN     "channelMessageId" INTEGER;

