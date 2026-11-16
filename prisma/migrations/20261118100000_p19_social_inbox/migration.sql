-- AlterTable
ALTER TABLE "MatrixAccount" ADD COLUMN     "inboxAt" TIMESTAMP(3),
ADD COLUMN     "inboxSync" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SocialThread" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "peerName" TEXT,
    "peerHandle" TEXT,
    "peerUrl" TEXT,
    "peerAvatar" TEXT,
    "peerLang" TEXT,
    "customerId" TEXT,
    "leadId" TEXT,
    "assigneeId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastText" TEXT,
    "lastFromMe" BOOLEAN NOT NULL DEFAULT false,
    "unread" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "externalId" TEXT,
    "fromMe" BOOLEAN NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "translation" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "group" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ownerId" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialThread_tenantId_lastMessageAt_idx" ON "SocialThread"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SocialThread_tenantId_assigneeId_idx" ON "SocialThread"("tenantId", "assigneeId");

-- CreateIndex
CREATE INDEX "SocialThread_tenantId_customerId_idx" ON "SocialThread"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialThread_accountId_externalId_key" ON "SocialThread"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "SocialMessage_threadId_timestamp_idx" ON "SocialMessage"("threadId", "timestamp");

-- CreateIndex
CREATE INDEX "SocialMessage_tenantId_status_idx" ON "SocialMessage"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMessage_threadId_externalId_key" ON "SocialMessage"("threadId", "externalId");

-- CreateIndex
CREATE INDEX "QuickReply_tenantId_ownerId_idx" ON "QuickReply"("tenantId", "ownerId");

-- AddForeignKey
ALTER TABLE "SocialThread" ADD CONSTRAINT "SocialThread_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialThread" ADD CONSTRAINT "SocialThread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MatrixAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialThread" ADD CONSTRAINT "SocialThread_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialThread" ADD CONSTRAINT "SocialThread_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SocialThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 内置管理员、销售经理角色默认能看社媒私信里客户的联系方式
UPDATE "Role" SET "permissions" = array_append("permissions", 'matrix.reveal')
WHERE "systemKey" IN ('admin', 'manager') AND NOT ('matrix.reveal' = ANY("permissions"));
