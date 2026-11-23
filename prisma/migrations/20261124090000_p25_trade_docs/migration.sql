-- CreateTable
CREATE TABLE "TradeDoc" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "type" TEXT NOT NULL,
    "no" TEXT,
    "buyer" TEXT,
    "data" JSONB NOT NULL,
    "chat" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeDoc_tenantId_ownerId_updatedAt_idx" ON "TradeDoc"("tenantId", "ownerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "TradeDoc" ADD CONSTRAINT "TradeDoc_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDoc" ADD CONSTRAINT "TradeDoc_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
