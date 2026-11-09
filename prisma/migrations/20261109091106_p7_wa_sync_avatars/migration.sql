-- AlterTable
ALTER TABLE "WaAccount" ADD COLUMN     "avatarAt" TIMESTAMP(3),
ADD COLUMN     "avatarKey" TEXT,
ADD COLUMN     "syncDoneAt" TIMESTAMP(3),
ADD COLUMN     "syncMessages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncProgress" INTEGER,
ADD COLUMN     "syncStartedAt" TIMESTAMP(3),
ADD COLUMN     "syncStatus" TEXT;

-- AlterTable
ALTER TABLE "WaChat" ADD COLUMN     "avatarAt" TIMESTAMP(3),
ADD COLUMN     "avatarKey" TEXT,
ADD COLUMN     "lastFromMe" BOOLEAN NOT NULL DEFAULT false;

-- 回填：最后一条消息是不是自己发的
UPDATE "WaChat" c SET "lastFromMe" = m."fromMe"
FROM (SELECT DISTINCT ON ("chatId") "chatId", "fromMe" FROM "WaMessage" ORDER BY "chatId", "timestamp" DESC) m
WHERE m."chatId" = c.id;

-- 已连接的账号视为同步完成（避免一直显示「同步中」）
UPDATE "WaAccount" SET "syncStatus" = 'done', "syncDoneAt" = now() WHERE "status" = 'CONNECTED';
