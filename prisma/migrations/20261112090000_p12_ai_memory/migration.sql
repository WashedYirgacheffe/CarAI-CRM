-- AI 记忆：对话存库、记忆条目
-- CreateTable
CREATE TABLE "AiThread" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "turns" JSONB NOT NULL,
    "summary" TEXT,
    "summaryUpTo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMemory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "userId" TEXT,
    "customerId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "createdByKind" TEXT NOT NULL DEFAULT 'ai',
    "status" TEXT NOT NULL DEFAULT 'active',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "supersededById" TEXT,
    "recurrence" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "threadId" TEXT,
    "confirmedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiThread_tenantId_userId_updatedAt_idx" ON "AiThread"("tenantId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiMemory_tenantId_scope_status_idx" ON "AiMemory"("tenantId", "scope", "status");

-- CreateIndex
CREATE INDEX "AiMemory_tenantId_userId_status_idx" ON "AiMemory"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "AiMemory_tenantId_customerId_status_idx" ON "AiMemory"("tenantId", "customerId", "status");

-- AddForeignKey
ALTER TABLE "AiThread" ADD CONSTRAINT "AiThread_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiThread" ADD CONSTRAINT "AiThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

