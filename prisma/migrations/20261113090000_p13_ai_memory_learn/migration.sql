-- AI 记忆第二、三期：检索关键词、向量、来源；客户提炼进度

-- AlterTable
ALTER TABLE "AiMemory" ADD COLUMN     "embedModel" TEXT,
ADD COLUMN     "embedding" DOUBLE PRECISION[],
ADD COLUMN     "keywords" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "origin" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "memoryScannedAt" TIMESTAMP(3);

