-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'QUALIFYING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'DRAFT';
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "OrderStatus" ADD VALUE 'AFTER_SALES';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuotationStatus" ADD VALUE 'APPROVED';
ALTER TYPE "QuotationStatus" ADD VALUE 'CONVERTED';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "invalidAt" TIMESTAMP(3),
ADD COLUMN     "invalidNote" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "approval" "ApprovalStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "approval" "ApprovalStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dashboardCards" TEXT[] DEFAULT ARRAY[]::TEXT[];
