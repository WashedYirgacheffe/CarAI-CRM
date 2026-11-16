-- 社媒矩阵：账号封面截图、任务进度、桌面版状态说明
ALTER TABLE "MatrixAccount" ADD COLUMN "snapshotKey" TEXT, ADD COLUMN "snapshotAt" TIMESTAMP(3);
ALTER TABLE "MatrixJob" ADD COLUMN "progress" TEXT;
ALTER TABLE "MatrixDevice" ADD COLUMN "statusNote" TEXT;
