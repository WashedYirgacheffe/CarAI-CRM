-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "matrixCloudEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MatrixAccount" ADD COLUMN     "deviceId" TEXT;

-- CreateTable
CREATE TABLE "MatrixDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "os" TEXT,
    "appVersion" TEXT,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatrixDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatrixDevice_tokenHash_key" ON "MatrixDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "MatrixDevice_tenantId_idx" ON "MatrixDevice"("tenantId");

-- CreateIndex
CREATE INDEX "MatrixDevice_userId_idx" ON "MatrixDevice"("userId");

-- AddForeignKey
ALTER TABLE "MatrixAccount" ADD CONSTRAINT "MatrixAccount_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "MatrixDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixDevice" ADD CONSTRAINT "MatrixDevice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatrixDevice" ADD CONSTRAINT "MatrixDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

