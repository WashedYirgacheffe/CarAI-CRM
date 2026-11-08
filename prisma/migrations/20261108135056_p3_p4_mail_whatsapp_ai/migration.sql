-- CreateEnum
CREATE TYPE "MailAccountStatus" AS ENUM ('ACTIVE', 'ERROR', 'PAUSED');

-- CreateEnum
CREATE TYPE "MailFolder" AS ENUM ('INBOX', 'SENT');

-- CreateEnum
CREATE TYPE "WaStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED');

-- CreateEnum
CREATE TYPE "WaMsgStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'RECEIVED');

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "signature" TEXT,
    "autoLead" BOOLEAN NOT NULL DEFAULT true,
    "status" "MailAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "syncState" JSONB NOT NULL DEFAULT '{}',
    "syncLockUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folder" "MailFolder" NOT NULL,
    "folderPath" TEXT,
    "uid" INTEGER,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT[],
    "fromAddr" TEXT NOT NULL,
    "fromName" TEXT,
    "toList" JSONB NOT NULL DEFAULT '[]',
    "ccList" JSONB NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL DEFAULT '',
    "text" TEXT,
    "html" TEXT,
    "snippet" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "customerId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "aiSummary" TEXT,
    "aiIntent" TEXT,
    "aiPriority" TEXT,
    "aiAnalyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "status" "WaStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "qr" TEXT,
    "qrAt" TIMESTAMP(3),
    "lastError" TEXT,
    "logoutRequested" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaChat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "customerId" TEXT,
    "contactId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastText" TEXT,
    "unread" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "waId" TEXT,
    "fromMe" BOOLEAN NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL DEFAULT '',
    "status" "WaMsgStatus" NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailAccount_userId_idx" ON "MailAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MailAccount_tenantId_email_key" ON "MailAccount"("tenantId", "email");

-- CreateIndex
CREATE INDEX "MailMessage_accountId_folder_date_idx" ON "MailMessage"("accountId", "folder", "date");

-- CreateIndex
CREATE INDEX "MailMessage_tenantId_customerId_date_idx" ON "MailMessage"("tenantId", "customerId", "date");

-- CreateIndex
CREATE INDEX "MailMessage_accountId_messageId_idx" ON "MailMessage"("accountId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MailMessage_accountId_folderPath_uid_key" ON "MailMessage"("accountId", "folderPath", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "WaAccount_userId_key" ON "WaAccount"("userId");

-- CreateIndex
CREATE INDEX "WaChat_tenantId_customerId_idx" ON "WaChat"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "WaChat_accountId_lastMessageAt_idx" ON "WaChat"("accountId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaChat_accountId_jid_key" ON "WaChat"("accountId", "jid");

-- CreateIndex
CREATE INDEX "WaMessage_chatId_timestamp_idx" ON "WaMessage"("chatId", "timestamp");

-- CreateIndex
CREATE INDEX "WaMessage_accountId_status_idx" ON "WaMessage"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_accountId_waId_key" ON "WaMessage"("accountId", "waId");

-- CreateIndex
CREATE UNIQUE INDEX "AiInsight_tenantId_kind_targetId_key" ON "AiInsight"("tenantId", "kind", "targetId");

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaAccount" ADD CONSTRAINT "WaAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaAccount" ADD CONSTRAINT "WaAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaChat" ADD CONSTRAINT "WaChat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaChat" ADD CONSTRAINT "WaChat_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaChat" ADD CONSTRAINT "WaChat_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaChat" ADD CONSTRAINT "WaChat_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WaChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 新权限点：给内置角色补上（管理员 / 销售经理 全部；业务员 WhatsApp + AI）
UPDATE "Role" SET "permissions" = array_cat("permissions", ARRAY['whatsapp.use','ai.use'])
WHERE "systemKey" IN ('admin','manager','sales') AND NOT ('whatsapp.use' = ANY("permissions"));
