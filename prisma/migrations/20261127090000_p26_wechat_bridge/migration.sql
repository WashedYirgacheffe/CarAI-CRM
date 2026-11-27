-- CreateEnum
CREATE TYPE "WxSyncStatus" AS ENUM ('DISCONNECTED', 'READY', 'SYNCING', 'ERROR');

-- CreateEnum
CREATE TYPE "WxMsgStatus" AS ENUM ('STAGED', 'SENT', 'UNCONFIRMED', 'RECEIVED', 'FAILED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "wechat" TEXT;

-- CreateTable
CREATE TABLE "WxAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wxid" TEXT,
    "wechatNo" TEXT,
    "name" TEXT,
    "deviceId" TEXT,
    "platform" TEXT,
    "syncMode" TEXT NOT NULL DEFAULT 'whitelist',
    "remarkPrefix" TEXT NOT NULL DEFAULT '客户-',
    "status" "WxSyncStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "syncMessages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WxAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WxChat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "wxKey" TEXT NOT NULL,
    "wechatNo" TEXT,
    "remark" TEXT,
    "name" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customerId" TEXT,
    "contactId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastText" TEXT,
    "unread" INTEGER NOT NULL DEFAULT 0,
    "lastFromMe" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WxChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WxMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "wxMsgId" TEXT,
    "fromMe" BOOLEAN NOT NULL,
    "senderName" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL DEFAULT '',
    "translation" TEXT,
    "mediaKey" TEXT,
    "mediaMime" TEXT,
    "mediaName" TEXT,
    "mediaSize" INTEGER,
    "status" "WxMsgStatus" NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "stagedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WxAccount_userId_key" ON "WxAccount"("userId");

-- CreateIndex
CREATE INDEX "WxAccount_tenantId_idx" ON "WxAccount"("tenantId");

-- CreateIndex
CREATE INDEX "WxChat_tenantId_customerId_idx" ON "WxChat"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "WxChat_accountId_lastMessageAt_idx" ON "WxChat"("accountId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "WxChat_accountId_wxKey_key" ON "WxChat"("accountId", "wxKey");

-- CreateIndex
CREATE INDEX "WxMessage_chatId_timestamp_idx" ON "WxMessage"("chatId", "timestamp");

-- CreateIndex
CREATE INDEX "WxMessage_accountId_status_idx" ON "WxMessage"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WxMessage_accountId_wxMsgId_key" ON "WxMessage"("accountId", "wxMsgId");

-- AddForeignKey
ALTER TABLE "WxAccount" ADD CONSTRAINT "WxAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WxAccount" ADD CONSTRAINT "WxAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WxChat" ADD CONSTRAINT "WxChat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WxChat" ADD CONSTRAINT "WxChat_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WxAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WxChat" ADD CONSTRAINT "WxChat_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WxChat" ADD CONSTRAINT "WxChat_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WxMessage" ADD CONSTRAINT "WxMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WxMessage" ADD CONSTRAINT "WxMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WxAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WxMessage" ADD CONSTRAINT "WxMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WxChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
