-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('BOOKING', 'BOOKED', 'LOADED', 'DEPARTED', 'ARRIVED', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "approvalDelete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvalDiscountPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "approvalRelease" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvalTransfer" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderPayment" ADD COLUMN     "fee" DECIMAL(14,2),
ADD COLUMN     "fileId" TEXT,
ADD COLUMN     "no" TEXT,
ADD COLUMN     "payer" TEXT;

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'BOOKING',
    "mode" TEXT NOT NULL DEFAULT 'sea',
    "forwarder" TEXT,
    "carrier" TEXT,
    "bookingNo" TEXT,
    "blNo" TEXT,
    "containerNo" TEXT,
    "containerType" TEXT,
    "sealNo" TEXT,
    "vessel" TEXT,
    "trackingNo" TEXT,
    "trackingUrl" TEXT,
    "portLoading" TEXT,
    "portDischarge" TEXT,
    "packages" INTEGER,
    "grossWeight" DECIMAL(12,3),
    "volume" DECIMAL(10,3),
    "cutoffAt" TIMESTAMP(3),
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "atd" TIMESTAMP(3),
    "ata" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "freight" DECIMAL(14,2),
    "freightCcy" TEXT,
    "remark" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "targetId" TEXT,
    "title" TEXT NOT NULL,
    "payload" JSONB,
    "reason" TEXT,
    "requesterId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "entityName" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentPlan_tenantId_dueDate_idx" ON "PaymentPlan"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "PaymentPlan_orderId_idx" ON "PaymentPlan"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_tenantId_status_eta_idx" ON "Shipment"("tenantId", "status", "eta");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_customerId_idx" ON "Shipment"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_tenantId_no_key" ON "Shipment"("tenantId", "no");

-- CreateIndex
CREATE INDEX "ShipmentEvent_shipmentId_at_idx" ON "ShipmentEvent"("shipmentId", "at");

-- CreateIndex
CREATE INDEX "ApprovalRequest_tenantId_status_createdAt_idx" ON "ApprovalRequest"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_tenantId_requesterId_createdAt_idx" ON "ApprovalRequest"("tenantId", "requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_tenantId_kind_targetId_idx" ON "ApprovalRequest"("tenantId", "kind", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entity_entityId_idx" ON "AuditLog"("tenantId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_userId_createdAt_idx" ON "AuditLog"("tenantId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CrmFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 内置管理员能看操作日志；管理员、销售经理能审批
UPDATE "Role" SET "permissions" = array_append("permissions", 'settings.audit')
WHERE "systemKey" = 'admin' AND NOT ('settings.audit' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'approval.review')
WHERE "systemKey" IN ('admin', 'manager') AND NOT ('approval.review' = ANY("permissions"));
