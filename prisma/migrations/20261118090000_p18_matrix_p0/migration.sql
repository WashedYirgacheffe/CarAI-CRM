-- AlterTable
ALTER TABLE "MatrixAccount" ADD COLUMN     "group" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "MatrixUsage" (
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "cloudSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatrixUsage_pkey" PRIMARY KEY ("tenantId","month")
);

-- AddForeignKey
ALTER TABLE "MatrixUsage" ADD CONSTRAINT "MatrixUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
