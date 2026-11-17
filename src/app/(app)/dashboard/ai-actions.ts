"use server";

import { deleteFileAction, saveAttachmentAction, updateFileAction } from "@/app/(app)/files/actions";
import { requireUser } from "@/server/auth";
import { sendMailAction } from "@/app/(app)/mail/actions";
import { sendCrmFileAction, sendFormAction, sendProductAction, sendQuotationAction, sendWaMessageAction } from "@/app/(app)/whatsapp/actions";
import { deleteTaskAction, saveTaskAction, toggleTaskAction } from "@/app/(app)/schedule/actions";
import {
  addFollowUpAction,
  createCustomerAction,
  deleteContactAction,
  deleteCustomerAction,
  releaseCustomersAction,
  saveContactAction,
  transferCustomersAction,
  updateCustomerAction,
} from "@/app/(app)/customers/actions";
import { convertLeadAction, deleteLeadAction, saveLeadAction, setLeadStatusAction } from "@/app/(app)/leads/actions";
import { deleteQuotationAction, saveQuotationAction, setQuotationStatusAction } from "@/app/(app)/quotations/actions";
import { deleteOrderAction, setOrderStatusAction } from "@/app/(app)/orders/actions";
import { deleteOpportunityAction, moveOpportunityAction } from "@/app/(app)/opportunities/actions";
import { deleteProductAction } from "@/app/(app)/products/actions";
import { enrollAction, setSequenceStatusAction } from "@/app/(app)/marketing/actions";
import { isAiActionKind, type ActionResult } from "@/lib/ai-actions";
import type { ActionState } from "@/lib/action";

const form = (p: Record<string, string>, keys: string[]) => {
  const fd = new FormData();
  for (const k of keys) if (p[k] != null && p[k] !== "") fd.set(k, String(p[k]));
  return fd;
};

const CUSTOMER_KEYS = [
  "name",
  "country",
  "website",
  "address",
  "source",
  "customerType",
  "mainProducts",
  "annualVolume",
  "remark",
  "statusId",
  "groupId",
  "star",
  "tags",
];
const ids = (v: string | undefined) => (v ?? "").split(",").filter(Boolean);

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
    case "send_email": {
      const fd = form(p, ["accountId", "to", "subject", "text"]);
      for (const id of ids(p.fileIds)) fd.append("fileIds", id);
      return out(await sendMailAction({}, fd), "邮件已发送");
    }
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
        href: "/todo?view=list",
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

    // ── 客户和联系人 ──
    case "create_customer": {
      const r = await createCustomerAction({}, form(p, [...CUSTOMER_KEYS, "contactName", "contactTitle", "contactEmail", "contactPhone", "contactWhatsapp"]));
      return out(r, "客户已创建", r.id ? { href: `/customers/${r.id}`, hrefLabel: "打开客户" } : {});
    }
    case "update_customer":
      return out(await updateCustomerAction({}, form(p, ["id", ...CUSTOMER_KEYS])), "客户资料已更新", {
        href: `/customers/${p.id}`,
        hrefLabel: "打开客户",
      });
    case "delete_customer":
      return out(await deleteCustomerAction(p.customerId), "客户已删除");
    case "transfer_customer":
      return out(await transferCustomersAction(ids(p.customerIds), p.toUserId), "已转移");
    case "release_customer":
      return out(await releaseCustomersAction(ids(p.customerIds), p.reason ?? ""), "已放入公海");
    case "save_contact":
      return out(await saveContactAction({}, form(p, ["id", "customerId", "name", "title", "email", "phone", "whatsapp", "remark", "isPrimary"])), "联系人已保存");
    case "delete_contact":
      return out(await deleteContactAction(p.contactId), "联系人已删除");

    // ── 线索 ──
    case "update_lead":
      return out(
        await saveLeadAction({}, form(p, ["id", "companyName", "contactName", "email", "phone", "whatsapp", "country", "source", "products", "inquiry", "unassigned"])),
        "线索已更新",
      );
    case "set_lead_status":
      return out(
        await setLeadStatusAction(p.leadId, p.status as "NEW" | "QUALIFYING" | "CONTACTED" | "INVALID", { reason: p.reason, note: p.note }),
        "线索状态已更新",
      );
    case "convert_lead": {
      const r = await convertLeadAction({}, form(p, ["id", "customerName", "withOpportunity", "oppName", "amount", "currency"]));
      return out(r, "已转为客户", r.customerId ? { href: `/customers/${r.customerId}`, hrefLabel: "打开客户" } : {});
    }
    case "delete_lead":
      return out(await deleteLeadAction(p.leadId), "线索已删除");

    // ── 日程、单据、商机、产品 ──
    case "complete_task":
      return out(await toggleTaskAction(p.taskId, true), "已完成");
    case "delete_task":
      return out(await deleteTaskAction(p.taskId), "日程已删除");
    case "set_quotation_status":
      return out(await setQuotationStatusAction(p.quotationId, p.status), "报价单状态已更新");
    case "delete_quotation":
      return out(await deleteQuotationAction(p.quotationId), "报价单已删除");
    case "set_order_status":
      return out(await setOrderStatusAction(p.orderId, p.status), "订单状态已更新");
    case "delete_order":
      return out(await deleteOrderAction(p.orderId), "订单已删除");
    case "move_opportunity":
      return out(await moveOpportunityAction(p.opportunityId, p.stageId), "商机阶段已更新");
    case "delete_opportunity":
      return out(await deleteOpportunityAction(p.opportunityId), "商机已删除");
    case "delete_product":
      return out(await deleteProductAction(p.productId), "产品已删除");
    case "update_file": {
      const r = await updateFileAction(p.fileId, { name: p.name, category: p.category, note: p.note, customerId: p.customerId });
      return out(r, "文件已更新", r.ok && p.customerId ? { href: `/customers/${p.customerId}`, hrefLabel: "打开客户" } : {});
    }
    case "delete_file":
      return out(await deleteFileAction(p.fileId), "文件已删除");
    case "save_attachment": {
      const r = await saveAttachmentAction({ customerId: p.customerId, waMessageId: p.waMessageId, mailId: p.mailId, attId: p.attId, category: p.category });
      return out(r, "已存到客户资料", r.ok ? { href: `/customers/${p.customerId}`, hrefLabel: "打开客户" } : {});
    }
    case "send_file_whatsapp": {
      const list = ids(p.fileIds);
      let sent = 0;
      for (const [i, id] of list.entries()) {
        const r = await sendCrmFileAction(p.chatId, id, i === 0 ? (p.caption ?? "") : "");
        if (!r.ok) return { ok: false, message: sent ? `已发 ${sent} 个，第 ${i + 1} 个失败：${r.message}` : (r.message ?? "发送失败") };
        sent++;
      }
      return { ok: true, message: list.length > 1 ? `${list.length} 个文件已排队发送` : "文件已排队发送，几秒内送达" };
    }
  }
}
