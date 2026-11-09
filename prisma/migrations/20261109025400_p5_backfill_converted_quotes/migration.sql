-- 已经转出订单的报价单标记为「已转订单」（新枚举值要在单独的迁移里使用）
UPDATE "Quotation" SET "status" = 'CONVERTED'
WHERE "status" IN ('ACCEPTED', 'SENT', 'DRAFT') AND "id" IN (SELECT "quotationId" FROM "Order" WHERE "quotationId" IS NOT NULL);
