-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "kind" TEXT,
ADD COLUMN     "link" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "snoozeCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MailMessage" ADD COLUMN     "bouncedAt" TIMESTAMP(3),
ADD COLUMN     "clickCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enrollmentId" TEXT,
ADD COLUMN     "lastOpenAt" TIMESTAMP(3),
ADD COLUMN     "openCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "trackId" TEXT;

-- CreateTable
CREATE TABLE "MailEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "SequenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "dailyLimit" INTEGER NOT NULL DEFAULT 100,
    "workHours" BOOLEAN NOT NULL DEFAULT true,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailSequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "MailSequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailEnrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "country" TEXT,
    "customerId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "step" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailSuppression" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailEvent_messageId_createdAt_idx" ON "MailEvent"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "MailEvent_tenantId_createdAt_idx" ON "MailEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "MailSequence_tenantId_ownerId_idx" ON "MailSequence"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX "MailSequenceStep_sequenceId_sort_idx" ON "MailSequenceStep"("sequenceId", "sort");

-- CreateIndex
CREATE INDEX "MailEnrollment_status_nextAt_idx" ON "MailEnrollment"("status", "nextAt");

-- CreateIndex
CREATE INDEX "MailEnrollment_tenantId_email_idx" ON "MailEnrollment"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MailEnrollment_sequenceId_email_key" ON "MailEnrollment"("sequenceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MailSuppression_tenantId_email_key" ON "MailSuppression"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MailMessage_trackId_key" ON "MailMessage"("trackId");

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "MailEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailEvent" ADD CONSTRAINT "MailEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailEvent" ADD CONSTRAINT "MailEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSequence" ADD CONSTRAINT "MailSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSequence" ADD CONSTRAINT "MailSequence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSequenceStep" ADD CONSTRAINT "MailSequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "MailSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailEnrollment" ADD CONSTRAINT "MailEnrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailEnrollment" ADD CONSTRAINT "MailEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "MailSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailEnrollment" ADD CONSTRAINT "MailEnrollment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSuppression" ADD CONSTRAINT "MailSuppression_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

