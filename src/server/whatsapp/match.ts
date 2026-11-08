import "server-only";
import { prisma } from "@/server/db";

export function digitsOf(v: string | null | undefined) {
  return (v ?? "").replace(/\D/g, "");
}

/** 按手机号匹配联系人（WhatsApp 或电话字段，忽略空格、加号、横线） */
export async function matchContactByPhone(tenantId: string, phone: string | null | undefined) {
  const d = digitsOf(phone);
  if (d.length < 7) return null;
  const rows = await prisma.$queryRaw<{ id: string; customerId: string }[]>`
    SELECT id, "customerId" FROM "Contact"
    WHERE "tenantId" = ${tenantId}
      AND (regexp_replace(coalesce(whatsapp, ''), '\\D', '', 'g') = ${d}
        OR regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${d})
    LIMIT 1`;
  return rows[0] ?? null;
}
