-- p15：垃圾邮件文件夹、分享链接访问记录（报价单 / 表单 / 产品卡）、跟进记录合并键、产品卡 Listing 字段
-- AlterEnum
ALTER TYPE "MailFolder" ADD VALUE 'JUNK';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "refKey" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "bullets" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "keywords" TEXT,
ADD COLUMN     "listingDesc" TEXT,
ADD COLUMN     "listingTitle" TEXT,
ADD COLUMN     "listingUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ShareVisit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "customerId" TEXT,
    "chatId" TEXT,
    "productId" TEXT,
    "visitorKey" TEXT NOT NULL,
    "ip" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "device" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "ua" TEXT,
    "referrer" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeMs" INTEGER NOT NULL DEFAULT 0,
    "maxScroll" INTEGER NOT NULL DEFAULT 0,
    "sections" JSONB NOT NULL DEFAULT '{}',
    "events" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ShareVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareVisit_tenantId_refKey_startedAt_idx" ON "ShareVisit"("tenantId", "refKey", "startedAt");

-- CreateIndex
CREATE INDEX "ShareVisit_tenantId_productId_startedAt_idx" ON "ShareVisit"("tenantId", "productId", "startedAt");

-- CreateIndex
CREATE INDEX "ShareVisit_tenantId_customerId_startedAt_idx" ON "ShareVisit"("tenantId", "customerId", "startedAt");

-- CreateIndex
CREATE INDEX "ShareVisit_tenantId_visitorKey_lastSeenAt_idx" ON "ShareVisit"("tenantId", "visitorKey", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Activity_tenantId_refKey_idx" ON "Activity"("tenantId", "refKey");

-- AddForeignKey
ALTER TABLE "ShareVisit" ADD CONSTRAINT "ShareVisit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareVisit" ADD CONSTRAINT "ShareVisit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareVisit" ADD CONSTRAINT "ShareVisit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

