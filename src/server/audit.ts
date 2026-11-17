import "server-only";
import { headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

/** 操作日志里的对象类型（页面筛选用） */
export const AUDIT_ENTITIES: Record<string, string> = {
  customer: "客户",
  contact: "联系人",
  quotation: "报价单",
  order: "订单",
  payment: "收款",
  shipment: "物流",
  file: "文件",
  member: "成员",
  role: "角色",
  department: "部门",
  settings: "设置",
  approval: "审批",
};

export const AUDIT_ACTIONS: Record<string, string> = {
  create: "新建",
  update: "修改",
  delete: "删除",
  transfer: "转移",
  release: "退公海",
  claim: "领取",
  assign: "分配",
  status: "改状态",
  submit: "提交审批",
  approve: "审批通过",
  reject: "审批驳回",
  export: "导出",
};

type Actor = { id: string; name: string; tenantId: string };

export type AuditInput = {
  action: keyof typeof AUDIT_ACTIONS | (string & {});
  entity: keyof typeof AUDIT_ENTITIES | (string & {});
  entityId?: string | null;
  entityName?: string | null;
  summary: string;
  detail?: Prisma.InputJsonValue;
};

async function clientIp() {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    return null; // worker 等没有请求上下文的地方
  }
}

/** 记一条操作日志。永远不抛错，不影响业务本身 */
export async function audit(user: Actor, input: AuditInput | AuditInput[]) {
  const list = Array.isArray(input) ? input : [input];
  if (!list.length) return;
  try {
    const ip = await clientIp();
    await prisma.auditLog.createMany({
      data: list.map((i) => ({
        tenantId: user.tenantId,
        userId: user.id,
        userName: user.name,
        action: i.action,
        entity: i.entity,
        entityId: i.entityId ?? null,
        entityName: i.entityName?.slice(0, 200) ?? null,
        summary: i.summary.slice(0, 500),
        detail: i.detail,
        ip,
      })),
    });
  } catch (e) {
    console.error("[audit]", e);
  }
}

/** 比较两份数据，返回改动过的字段 { 字段名: [旧, 新] }；labels 只比较列出的字段，并用中文名做键 */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>) {
  const norm = (v: unknown) => {
    if (v === undefined || v === null || v === "") return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object" && "toString" in (v as object) && !Array.isArray(v)) return String(v);
    return v as Prisma.InputJsonValue;
  };
  const out: Record<string, [Prisma.InputJsonValue | null, Prisma.InputJsonValue | null]> = {};
  for (const [k, label] of Object.entries(labels)) {
    if (!(k in after)) continue;
    const a = norm(before[k]);
    const b = norm(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[label] = [a, b];
  }
  return out;
}
