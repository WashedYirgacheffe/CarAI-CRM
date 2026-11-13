-- 第十四期：AI 穿透报告（客户公司公开信息调查）
-- CreateTable
CREATE TABLE "AiResearch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "query" TEXT NOT NULL,
    "domain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "report" JSONB,
    "score" INTEGER,
    "summary" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiResearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiResearch_tenantId_customerId_createdAt_idx" ON "AiResearch"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "AiResearch_tenantId_createdAt_idx" ON "AiResearch"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiResearch" ADD CONSTRAINT "AiResearch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResearch" ADD CONSTRAINT "AiResearch_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

