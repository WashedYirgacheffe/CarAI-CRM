-- WhatsApp：会话置顶 / 归档，消息回复引用 / 星标 / 为我删除
ALTER TABLE "WaChat" ADD COLUMN "pinnedAt" TIMESTAMP(3),
ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WaMessage" ADD COLUMN "quotedId" TEXT,
ADD COLUMN "starred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hiddenAt" TIMESTAMP(3);
