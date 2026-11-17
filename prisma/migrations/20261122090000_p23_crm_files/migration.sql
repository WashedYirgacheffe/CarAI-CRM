
-- CreateTable
CREATE TABLE "CrmFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT,
    "textState" TEXT NOT NULL DEFAULT 'skip',
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmFile_tenantId_customerId_createdAt_idx" ON "CrmFile"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmFile_tenantId_createdById_idx" ON "CrmFile"("tenantId", "createdById");

-- AddForeignKey
ALTER TABLE "CrmFile" ADD CONSTRAINT "CrmFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFile" ADD CONSTRAINT "CrmFile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFile" ADD CONSTRAINT "CrmFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

