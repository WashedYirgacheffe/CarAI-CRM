-- CreateTable
CREATE TABLE "MatrixProxy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'http',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "passwordEnc" TEXT,
    "note" TEXT,
    "exitIp" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "isp" TEXT,
    "hosting" BOOLEAN,
    "latencyMs" INTEGER,
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatrixProxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrixAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "login" TEXT,
    "passwordEnc" TEXT,
    "ownerId" TEXT,
    "proxyId" TEXT,
    "os" TEXT NOT NULL DEFAULT 'windows',
    "fingerprint" JSONB,
    "status" TEXT NOT NULL DEFAULT 'new',
    "statusNote" TEXT,
    "loggedInAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatrixAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrixJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "runner" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MatrixJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrixEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "runner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatrixEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatrixProxy_tenantId_idx" ON "MatrixProxy"("tenantId");

-- CreateIndex
CREATE INDEX "MatrixAccount_tenantId_platform_idx" ON "MatrixAccount"("tenantId", "platform");

-- CreateIndex
CREATE INDEX "MatrixJob_status_createdAt_idx" ON "MatrixJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MatrixJob_tenantId_accountId_createdAt_idx" ON "MatrixJob"("tenantId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "MatrixEvent_tenantId_accountId_createdAt_idx" ON "MatrixEvent"("tenantId", "accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "MatrixProxy" ADD CONSTRAINT "MatrixProxy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixAccount" ADD CONSTRAINT "MatrixAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixAccount" ADD CONSTRAINT "MatrixAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixAccount" ADD CONSTRAINT "MatrixAccount_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "MatrixProxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixJob" ADD CONSTRAINT "MatrixJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixJob" ADD CONSTRAINT "MatrixJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MatrixAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixEvent" ADD CONSTRAINT "MatrixEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixEvent" ADD CONSTRAINT "MatrixEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MatrixAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MatrixRunner" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "host" TEXT NOT NULL,
    "version" TEXT,
    "busy" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatrixRunner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatrixRunner_tenantId_lastSeenAt_idx" ON "MatrixRunner"("tenantId", "lastSeenAt");

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "matrixRunnerTokenHash" TEXT;

