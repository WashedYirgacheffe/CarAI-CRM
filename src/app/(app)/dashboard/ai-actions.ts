"use server";

import { requireUser } from "@/server/auth";
import { saveQuotationAction } from "@/app/(app)/quotations/actions";
import { sendMailAction } from "@/app/(app)/mail/actions";
import { sendFormAction, sendProductAction, sendQuotationAction, sendWaMessageAction } from "@/app/(app)/whatsapp/actions";
import { saveTaskAction } from "@/app/(app)/schedule/actions";
import { addFollowUpAction } from "@/app/(app)/customers/actions";
import { saveLeadAction } from "@/app/(app)/leads/actions";
import { enrollAction, setSequenceStatusAction } from "@/app/(app)/marketing/actions";
import { isAiActionKind, type ActionResult } from "@/lib/ai-actions";
import type { ActionState } from "@/lib/action";

const form = (p: Record<string, string>, keys: string[]) => {
  const fd = new FormData();
  for (const k of keys) if (p[k] != null && p[k] !== "") fd.set(k, String(p[k]));
  return fd;
};

const out = (r: ActionState, fallback: string, extra?: Partial<ActionResult>): ActionResult => {
  const fields = r.fieldErrors ? Object.values(r.fieldErrors).flat().filter(Boolean).join("；") : "";
  return { ok: !!r.ok, message: r.message || fields || (r.ok ? fallback : "操作失败"), ...(r.ok ? extra : {}) };
};

/**
 * 用户在 AI 卡片上点了「确认」：交给原有的业务动作执行。
 * 权限、数据范围、校验都由这些动作自己负责，和在页面里手动操作完全一样。
 */
export async function runAiActionAction(kind: string, raw: Record<string, string>): Promise<ActionResult> {
  await requireUser();
  if (!isAiActionKind(kind)) return { ok: false, message: "未知操作" };
  const p = Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")]));
  switch (kind) {
    case "send_whatsapp":
      return out(await sendWaMessageAction(p.chatId, p.text), "已发送，几秒内送达");
    case "send_email":
      return out(await sendMailAction({}, form(p, ["accountId", "to", "subject", "text"])), "邮件已发送");
    case "create_quotation": {
      const r = await saveQuotationAction(
        {},
        form(p, [
          "customerId",
          "buyerName",
          "buyerContact",
          "buyerEmail",
          "buyerPhone",
          "buyerAddress",
          "currency",
          "tradeTerm",
          "port",
          "paymentTerm",
          "title",
          "quoteDate",
          "validUntil",
          "terms",
          "remark",
          "items",
        ]),
      );
      return out(r, "报价单已保存", r.id ? { href: `/quotations/${r.id}`, hrefLabel: "打开报价单" } : {});
    }
    case "send_quotation":
      return out(await sendQuotationAction(p.chatId, p.quotationId), "报价单已发送");
    case "send_product":
      return out(await sendProductAction(p.chatId, p.productId, p.withPrice === "true"), "产品已发送");
    case "send_form":
      return out(await sendFormAction(p.chatId, p.form === "shipping" ? "shipping" : "inquiry"), "表单已发送");
    case "create_task":
      return out(await saveTaskAction({}, form(p, ["title", "dueAt", "customerId", "kind"])), "提醒已添加", {
        href: "/schedule",
        hrefLabel: "看日程",
      });
    case "add_followup":
      return out(await addFollowUpAction({}, form(p, ["customerId", "method", "content"])), "已记录跟进");
    case "create_lead":
      return out(
        await saveLeadAction({}, form(p, ["companyName", "contactName", "email", "phone", "whatsapp", "country", "source", "products", "inquiry"])),
        "线索已创建",
        { href: "/leads", hrefLabel: "看线索" },
      );
    case "enroll_sequence":
      return out(await enrollAction(p.sequenceId, { kind: "customer", ids: p.customerIds.split(",").filter(Boolean) }), "已加入序列", {
        href: `/marketing/${p.sequenceId}`,
        hrefLabel: "打开序列",
      });
    case "set_sequence_status":
      return out(await setSequenceStatusAction(p.sequenceId, p.active === "true"), p.active === "true" ? "序列已启动" : "序列已暂停");
  }
}
