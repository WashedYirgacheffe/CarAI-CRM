-- 第十六期：社媒（客户社媒账号、社媒动态跟踪、对外聚合主页 Link-in-Bio）
-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "socialWatchStar" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "CustomerSocial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "handle" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "watch" BOOLEAN NOT NULL DEFAULT true,
    "feedUrl" TEXT,
    "fingerprint" TEXT,
    "checkedAt" TIMESTAMP(3),
    "changedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSocial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "socialId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'post',
    "title" TEXT NOT NULL,
    "url" TEXT,
    "summary" TEXT,
    "image" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioPage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "departmentId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bio" TEXT,
    "avatar" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'sky',
    "links" JSONB NOT NULL DEFAULT '[]',
    "published" BOOLEAN NOT NULL DEFAULT true,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BioPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerSocial_tenantId_checkedAt_idx" ON "CustomerSocial"("tenantId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSocial_tenantId_customerId_url_key" ON "CustomerSocial"("tenantId", "customerId", "url");

-- CreateIndex
CREATE INDEX "SocialPost_tenantId_publishedAt_idx" ON "SocialPost"("tenantId", "publishedAt");

-- CreateIndex
CREATE INDEX "SocialPost_tenantId_customerId_publishedAt_idx" ON "SocialPost"("tenantId", "customerId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_socialId_externalId_key" ON "SocialPost"("socialId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BioPage_userId_key" ON "BioPage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BioPage_slug_key" ON "BioPage"("slug");

-- CreateIndex
CREATE INDEX "BioPage_tenantId_idx" ON "BioPage"("tenantId");

-- AddForeignKey
ALTER TABLE "CustomerSocial" ADD CONSTRAINT "CustomerSocial_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSocial" ADD CONSTRAINT "CustomerSocial_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_socialId_fkey" FOREIGN KEY ("socialId") REFERENCES "CustomerSocial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

