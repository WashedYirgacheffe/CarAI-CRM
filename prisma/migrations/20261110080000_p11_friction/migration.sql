-- 低摩擦：待办「已处理」、WhatsApp 翻译、上手清单
ALTER TABLE "User" ADD COLUMN "onboardingOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MailMessage" ADD COLUMN "doneAt" TIMESTAMP(3);
ALTER TABLE "WaMessage" ADD COLUMN "translation" TEXT;
