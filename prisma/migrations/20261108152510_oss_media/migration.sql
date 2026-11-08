-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "WaMessage" ADD COLUMN     "mediaKey" TEXT,
ADD COLUMN     "mediaMime" TEXT,
ADD COLUMN     "mediaName" TEXT,
ADD COLUMN     "mediaSize" INTEGER;
