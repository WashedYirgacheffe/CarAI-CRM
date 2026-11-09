-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "lastFollowAt" TIMESTAMP(3),
ADD COLUMN     "lastMailRecvAt" TIMESTAMP(3),
ADD COLUMN     "lastMailSentAt" TIMESTAMP(3),
ADD COLUMN     "lastWaAt" TIMESTAMP(3),
ADD COLUMN     "poolCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "poolDueAt" TIMESTAMP(3),
ADD COLUMN     "poolWarnedAt" TIMESTAMP(3),
ADD COLUMN     "prevOwnerId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "poolBasis" TEXT NOT NULL DEFAULT 'contact',
ADD COLUMN     "poolWarnDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "CustomerSegment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "poolDays" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionIgnore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionIgnore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerSegment_tenantId_idx" ON "CustomerSegment"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionIgnore_tenantId_key_key" ON "SuggestionIgnore"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Customer_tenantId_poolDueAt_idx" ON "Customer"("tenantId", "poolDueAt");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_prevOwnerId_fkey" FOREIGN KEY ("prevOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSegment" ADD CONSTRAINT "CustomerSegment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionIgnore" ADD CONSTRAINT "SuggestionIgnore_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 回填 ──
-- 系统自动记的「发送邮件」跟进标记为 mail_out，便于与手写跟进区分
UPDATE "Activity" SET "event" = 'mail_out'
WHERE "type" = 'FOLLOW_UP' AND "method" = 'EMAIL' AND "event" IS NULL AND "content" LIKE '【发送邮件】%';

UPDATE "Customer" c SET "lastFollowAt" = a.at
FROM (SELECT "customerId", MAX("createdAt") AS at FROM "Activity"
      WHERE "type" = 'FOLLOW_UP' AND "event" IS NULL AND "customerId" IS NOT NULL GROUP BY "customerId") a
WHERE a."customerId" = c."id";

UPDATE "Customer" c SET "lastMailSentAt" = m.at
FROM (SELECT "customerId", MAX("date") AS at FROM "MailMessage"
      WHERE "folder" = 'SENT' AND "customerId" IS NOT NULL GROUP BY "customerId") m
WHERE m."customerId" = c."id";

UPDATE "Customer" c SET "lastMailRecvAt" = m.at
FROM (SELECT "customerId", MAX("date") AS at FROM "MailMessage"
      WHERE "folder" = 'INBOX' AND "customerId" IS NOT NULL GROUP BY "customerId") m
WHERE m."customerId" = c."id";

UPDATE "Customer" c SET "lastWaAt" = w.at
FROM (SELECT ch."customerId", MAX(msg."timestamp") AS at FROM "WaMessage" msg
      JOIN "WaChat" ch ON ch."id" = msg."chatId"
      WHERE ch."customerId" IS NOT NULL GROUP BY ch."customerId") w
WHERE w."customerId" = c."id";

UPDATE "Customer" SET "lastContactAt" = GREATEST("lastContactAt", "lastFollowAt", "lastMailRecvAt", "lastMailSentAt", "lastWaAt")
WHERE COALESCE("lastFollowAt", "lastMailRecvAt", "lastMailSentAt", "lastWaAt") IS NOT NULL;

UPDATE "Customer" c SET "poolCount" = a.n
FROM (SELECT "customerId", COUNT(*)::int AS n FROM "Activity"
      WHERE "event" IN ('released', 'recycled') AND "customerId" IS NOT NULL GROUP BY "customerId") a
WHERE a."customerId" = c."id";
